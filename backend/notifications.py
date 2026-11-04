"""Anlık bildirimler: mahallede ya da yakınındaki su / elektrik kesintisi, kötü hava kalitesi ve
İzmir çevresinde M4+ deprem.

Saklanan veri (en az): Expo bildirim anahtarı, seçilen ilçe / mahalle, yakınlık yarıçapı, bildirim türleri
ve hangi olayın gönderildiği. Konum saklanmaz: "yakınımda" hesabı, seçilen mahallenin sunucudaki yaklaşık
merkezine (belediyenin konumlu verilerinden, bkz. areas.py) göre yapılır. Abonelik uygulamadan tek dokunuşla silinir (DELETE /api/bildirim/abone).
Gönderim Expo Push servisi (https://exp.host) üzerinden yapılır; Apple'a Expo iletir.
"""

from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from . import config
from .areas import norm, split_neighbourhoods
from .geo import haversine
from .quakes import age_hours

log = logging.getLogger("kent.bildirim")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,}\]$")
TYPES = ("su", "elektrik", "deprem", "hava")
AIR_LIMIT = 100  # PM10 µg/m³ üstü: "hassas gruplar için sağlıksız" ve kötüsü
AIR_STATION_MAX_KM = 10
QUAKE_MIN_MAG = 4.0
QUAKE_MAX_AGE_H = 2  # daha eski depremler için bildirim gönderilmez
CHECK_EVERY = 300  # sn
SENT_KEEP_DAYS = 14

TITLES = {"su": "su kesintisi", "elektrik": "elektrik kesintisi"}

# locate(ilce, mahalle) -> mahallenin yaklaşık merkezi (enlem, boylam) ya da None
Locate = Callable[[Any, Any], Any]


class Subscriptions:
    def __init__(self, path: Path):
        path.parent.mkdir(exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS abone (
                token TEXT PRIMARY KEY, ilce TEXT, mahalle TEXT, turler TEXT NOT NULL, guncelleme REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS gonderilen (
                token TEXT NOT NULL, olay TEXT NOT NULL, zaman REAL NOT NULL, PRIMARY KEY (token, olay)
            );
            """
        )
        # Eski veritabanı: yakınlık yarıçapı sütunu sonradan eklendi
        cols = {r[1] for r in self.db.execute("PRAGMA table_info(abone)")}
        if "yaricap" not in cols:
            self.db.execute("ALTER TABLE abone ADD COLUMN yaricap REAL NOT NULL DEFAULT 0")
        self.db.commit()

    def upsert(self, token: str, ilce: str | None, mahalle: str | None, turler: list[str], yaricap: float = 0) -> None:
        self.db.execute(
            "INSERT INTO abone(token, ilce, mahalle, turler, yaricap, guncelleme) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(token) DO UPDATE SET ilce=excluded.ilce, mahalle=excluded.mahalle, turler=excluded.turler, "
            "yaricap=excluded.yaricap, guncelleme=excluded.guncelleme",
            (token, ilce, mahalle, ",".join(turler), yaricap, time.time()),
        )
        self.db.commit()

    def get(self, token: str) -> dict | None:
        row = self.db.execute("SELECT ilce, mahalle, turler, yaricap FROM abone WHERE token=?", (token,)).fetchone()
        return {"ilce": row[0], "mahalle": row[1], "turler": [t for t in row[2].split(",") if t], "yaricap": row[3]} if row else None

    def delete(self, token: str) -> None:
        self.db.execute("DELETE FROM abone WHERE token=?", (token,))
        self.db.execute("DELETE FROM gonderilen WHERE token=?", (token,))
        self.db.commit()

    def all(self) -> list[dict]:
        return [
            {"token": t, "ilce": i, "mahalle": m, "turler": [x for x in tr.split(",") if x], "yaricap": r or 0}
            for t, i, m, tr, r in self.db.execute("SELECT token, ilce, mahalle, turler, yaricap FROM abone")
        ]

    def was_sent(self, token: str, event: str) -> bool:
        return self.db.execute("SELECT 1 FROM gonderilen WHERE token=? AND olay=?", (token, event)).fetchone() is not None

    def mark_sent(self, pairs: list[tuple[str, str]]) -> None:
        now = time.time()
        self.db.executemany("INSERT OR IGNORE INTO gonderilen(token, olay, zaman) VALUES (?,?,?)", [(t, e, now) for t, e in pairs])
        self.db.execute("DELETE FROM gonderilen WHERE zaman < ?", (now - SENT_KEEP_DAYS * 86400,))
        self.db.commit()

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM abone").fetchone()[0]


def valid_token(token: str) -> bool:
    return bool(TOKEN_RE.match(token or ""))


def _km(v: float) -> str:
    return f"{v:.1f}".replace(".", ",")


def _outage_distance(sub: dict, item: dict, centre, locate: Locate | None) -> float | None:
    """Kesinti aboneyi ilgilendiriyorsa mahallesine uzaklığı (km; kendi mahallesi 0), ilgilendirmiyorsa None."""
    names = split_neighbourhoods(item.get("mahalle"))
    if sub["ilce"] and norm(item.get("ilce")) == norm(sub["ilce"]):
        if not sub["mahalle"] or norm(sub["mahalle"]) in {norm(m) for m in names}:
            return 0.0  # kendi mahallesi (ya da yalnızca ilçe seçilmiş)
    radius = sub.get("yaricap") or 0
    if radius <= 0 or centre is None or locate is None:
        return None
    # Yakındaki mahalleler: ilçe sınırı gözetilmez (komşu ilçedeki kesinti de yakın olabilir)
    dists = [haversine(centre[0], centre[1], p[0], p[1]) / 1000 for p in (locate(item.get("ilce"), m) for m in names) if p]
    best = min(dists, default=None)
    return best if best is not None and best <= radius else None


def _outage_text(item: dict, km: float) -> str:
    when = item.get("duration") or ""
    near = f" · mahallenize ~{_km(km)} km" if km > 0 else ""
    return f"{item.get('ilce')} · {item.get('mahalle')}{near}" + (f" · {when}" if when else "")


def _air_event(stations: list[dict], centre) -> tuple[str, str, str] | None:
    """Mahalleye en yakın istasyonda PM10 eşiği aşıldıysa olay (istasyon ve ölçüm günü başına bir kez)."""
    if centre is None:
        return None
    near = [
        (haversine(centre[0], centre[1], s["lat"], s["lng"]) / 1000, s)
        for s in stations
        if s.get("lat") is not None and s.get("pm10") is not None
    ]
    near = [x for x in near if x[0] <= AIR_STATION_MAX_KM]
    if not near:
        return None
    _, st = min(near, key=lambda x: x[0])
    if st["pm10"] <= AIR_LIMIT:
        return None
    return (
        f"hava:{st['id']}:{(st.get('date') or '')[:10]}",
        f"Hava kalitesi: {st['level']['label']}",
        f"{st['name']} istasyonu PM10 {st['pm10']:g} µg/m³. Hassas gruplar dışarıda uzun süre kalmamalı.",
    )


def collect(
    subs: list[dict], layers: dict[str, list[dict]], was_sent, locate: Locate | None = None
) -> dict[str, list[tuple[str, str, str]]]:
    """Abone başına gönderilecek yeni olaylar: token -> [(olay_anahtarı, başlık, metin)].
    `locate` mahallenin yaklaşık merkezini verir; yakındaki kesintiler ve hava kalitesi için gerekir."""
    out: dict[str, list[tuple[str, str, str]]] = {}
    quakes = [q for q in layers.get("deprem", []) if (q.get("magnitude") or 0) >= QUAKE_MIN_MAG and age_hours(q) <= QUAKE_MAX_AGE_H]
    for sub in subs:
        events = []
        centre = locate(sub["ilce"], sub["mahalle"]) if locate and sub["mahalle"] else None
        for layer in ("su", "elektrik"):
            if layer not in sub["turler"]:
                continue
            for it in layers.get(layer, []):
                km = _outage_distance(sub, it, centre, locate)
                if km is not None:
                    where = "Mahallenizde" if km == 0 else "Yakınınızda"
                    events.append((f"{layer}:{it['id']}", f"{where} {TITLES[layer]} ({it.get('kind') or 'duyuru'})", _outage_text(it, km)))
        if "hava" in sub["turler"]:
            air = _air_event(layers.get("hava", []), centre)
            if air:
                events.append(air)
        if "deprem" in sub["turler"]:
            for q in quakes:
                events.append((q["id"], f"Deprem: {q['name']}", "AFAD verisi. Güvendeyseniz aile buluşma noktanızı hatırlayın; acil durumda 112."))
        new = [e for e in events if not was_sent(sub["token"], e[0])]
        if new:
            out[sub["token"]] = new
    return out


def build_messages(pending: dict[str, list[tuple[str, str, str]]]) -> list[dict]:
    """Aynı kişiye birden fazla olay düşerse tek bildirimde toplanır."""
    messages = []
    for token, events in pending.items():
        if len(events) == 1:
            _, title, body = events[0]
        else:
            title = f"{len(events)} yeni duyuru"
            body = " • ".join(t for _, t, _ in events[:4]) + (" …" if len(events) > 4 else "")
        messages.append({"to": token, "title": title, "body": body, "sound": "default", "data": {"olaylar": [k for k, _, _ in events]}})
    return messages


async def send(client: httpx.AsyncClient, messages: list[dict]) -> list[str]:
    """Expo Push'a 100'erli gruplarla gönderir; artık geçersiz (uygulaması silinmiş) anahtarları döndürür."""
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if config.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {config.EXPO_ACCESS_TOKEN}"
    invalid = []
    for i in range(0, len(messages), 100):
        batch = messages[i : i + 100]
        try:
            r = await client.post(EXPO_PUSH_URL, json=batch, headers=headers, timeout=30)
            r.raise_for_status()
            tickets = r.json().get("data", [])
        except (httpx.HTTPError, ValueError) as e:
            log.warning("Expo Push gönderimi başarısız: %s", type(e).__name__)
            continue
        for msg, ticket in zip(batch, tickets):
            if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                invalid.append(msg["to"])
    return invalid


async def run(store, client: httpx.AsyncClient, subs: Subscriptions, area_index=None) -> None:
    """Arka plan döngüsü: yeni olayları abonelere iletir. `area_index`: güncel AreaIndex'i veren eşzamansız işlev."""
    while True:
        await asyncio.sleep(CHECK_EVERY)
        try:
            locate = (await area_index()).lookup if area_index else None
            await check_once(store, client, subs, locate)
        except Exception:  # döngü asla durmasın
            log.exception("bildirim kontrolü başarısız")


async def check_once(store, client: httpx.AsyncClient, subs: Subscriptions, locate: Locate | None = None) -> int:
    all_subs = subs.all()
    if not all_subs:
        return 0
    layers: dict[str, list[dict[str, Any]]] = {}
    for lid in TYPES:
        entry = store.entries.get(lid)
        if entry and entry.has_data:
            layers[lid] = entry.items
    pending = collect(all_subs, layers, subs.was_sent, locate)
    if not pending:
        return 0
    messages = build_messages(pending)
    invalid = await send(client, messages)
    subs.mark_sent([(t, k) for t, events in pending.items() if t not in invalid for k, _, _ in events])
    for t in invalid:
        subs.delete(t)
    log.info("%d bildirim gönderildi, %d geçersiz anahtar silindi", len(messages) - len(invalid), len(invalid))
    return len(messages)
