"""Sağlık noktaları, deniz ve plajlar (körfez su ölçümleri dahil) ve hal fiyatları (İzBB Açık Veri)."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import math
from datetime import date, timedelta
from typing import Any

import httpx

from .geo import haversine
from .sources import API, SourceError, cbs, num
from .text import title_case, tr_lower

log = logging.getLogger("kent.city")
Item = dict[str, Any]

# ---------- Sağlık noktaları ----------

# (CBS servis adı, gösterilen tür, renk). "dalmerkezleri" tıp merkezleriyle aynı kayıtları verdiği için alınmaz.
HEALTH_SERVICES = [
    ("hastaneler", "Hastane", "#ff3b30"),
    ("acilyardimistasyonu", "112 Acil Sağlık İstasyonu", "#ff2d55"),
    ("ailesagligimerkezleri", "Aile Sağlığı Merkezi", "#34c759"),
    ("toplumsagligimerkezleri", "Toplum Sağlığı Merkezi", "#30b0c7"),
    ("anacocuksagligimerkezleri", "Ana Çocuk Sağlığı Merkezi", "#ff9500"),
    ("agizvedissagligimerkezleri", "Ağız ve Diş Sağlığı", "#5ac8fa"),
    ("kanmerkezleri", "Kan Merkezi", "#af52de"),
    ("poliklinikler", "Poliklinik", "#5856d6"),
    ("tipmerkezleri", "Tıp Merkezi", "#007aff"),
    ("laboratuvarlar", "Laboratuvar / Görüntüleme", "#8e8e93"),
    ("veremsavasdispanserleri", "Verem Savaş Dispanseri", "#a2845e"),
    ("veterinerlikler", "Veteriner", "#a2845e"),
]
HEALTH_ORDER = {kind: i for i, (_, kind, _) in enumerate(HEALTH_SERVICES)}
HEALTH_NOTES = {
    "112 Acil Sağlık İstasyonu": "Ambulans istasyonudur, hasta kabul yeri değildir. Acil durumda 112’yi arayın.",
    "Aile Sağlığı Merkezi": "Kayıtlı olduğunuz aile hekimini e-Devlet’ten öğrenebilirsiniz.",
}


async def saglik_noktalari(client: httpx.AsyncClient) -> list[Item]:
    async def one(service: str, kind: str, color: str) -> list[Item]:
        try:
            items = await cbs(client, service)
        except SourceError as e:
            log.warning("sağlık servisi %s alınamadı: %s", service, e)
            return []
        for it in items:
            it.update(kind=kind, kindColor=color)
        return items

    groups = await asyncio.gather(*(one(*s) for s in HEALTH_SERVICES))
    if not any(groups):
        raise SourceError("sağlık servislerinin hiçbiri yanıt vermedi")
    out, seen = [], set()
    for items in groups:
        for it in items:
            key = (tr_lower(it["name"]), round(it["lat"], 4), round(it["lng"], 4))
            if key in seen:  # aynı kurum birden çok listede
                continue
            seen.add(key)
            out.append(it)
    return out


# ---------- Deniz ve plajlar ----------

# Körfez Değerleri İzleme İstasyonları Konum Verisi (portaldaki CSV; 11 numaralı istasyonun konumu yok)
GULF_STATIONS = {
    1: ("Kale Feneri (Kırmızı)", 38.424667, 27.0175),
    2: ("Kale Feneri – Çakal Burnu arası", 38.42, 27.059833),
    3: ("Göztepe Feneri (Küçük)", 38.409167, 27.0825),
    4: ("Bostanlı Feneri (Büyük)", 38.4435, 27.090667),
    5: ("Karşıyaka Evlendirme Dairesi – Vapur İskelesi arası", 38.451333, 27.118167),
    6: ("Turyağ önü (Bayraklı)", 38.461833, 27.152),
    7: ("Meles Deresi çıkışı (Bayraklı)", 38.450833, 27.162667),
    8: ("Gündoğdu Meydanı açığı (Alsancak)", 38.436667, 27.138333),
    9: ("Konak Pier – Konak İskelesi arası", 38.421833, 27.127167),
    10: ("Özdilek AVM açığı (İnciraltı)", 38.413, 27.037),
    12: ("Güzelbahçe Pina Restoran açığı", 38.3855, 26.927833),
}
GULF_CSV = "https://openfiles.izmir.bel.tr/100187/docs/izbb-korfez-olcum-degerleri.csv"
TOO_MANY = math.inf  # "SKÇ": sayılamayacak kadar çok

# Tek ölçüm için yol gösterici eşikler (100 ml'de, deniz suyu): Yüzme Suyu Kalitesi Yönetmeliği'ndeki
# "mükemmel" (E. coli 250, enterokok 100) ve "iyi" (500, 200) sınırları. Resmî sınıflandırma birkaç yıllık
# ölçüm dizisine göre yapılır; burada yalnızca son ölçümün hangi aralıkta olduğu gösterilir.
WATER_LEVELS = [
    (250, 100, "Düşük kirlilik", "#34c759"),
    (500, 200, "Sınıra yakın", "#ffcc00"),
    (math.inf, math.inf, "Yüksek kirlilik", "#ff3b30"),
]
BLUE_FLAG_COLOR, BEACH_COLOR = "#007aff", "#5ac8fa"


def _count(v: str) -> float | None:
    v = (v or "").strip()
    if v.upper() == "SKÇ":
        return TOO_MANY
    return num(v.replace(",", "."))


def fmt_count(v: float | None) -> str | None:
    if v is None:
        return None
    if v == TOO_MANY:
        return "sayılamayacak kadar çok"
    return f"{round(v):,} / 100 ml".replace(",", ".")


def water_level(ecoli: float | None, entero: float | None) -> tuple[str, str]:
    if ecoli is None and entero is None:
        return "Ölçüm yok", "#8e8e93"
    for e_max, i_max, label, color in WATER_LEVELS:
        if (ecoli or 0) <= e_max and (entero or 0) <= i_max:
            return label, color
    return WATER_LEVELS[-1][2], WATER_LEVELS[-1][3]


async def _gulf(client: httpx.AsyncClient) -> list[Item]:
    try:
        r = await client.get(GULF_CSV, timeout=40)
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("körfez ölçümleri alınamadı: %s", type(e).__name__)
        return []
    latest: dict[int, dict] = {}
    for row in csv.DictReader(io.StringIO(r.text.lstrip("﻿")), delimiter=";"):
        kind = (row.get("OLCUM_TIPI") or "").strip()
        if (row.get("YUZEY_TIPI") or "").strip() != "Yüzey Suyu" or kind not in ("ESCHERICHIA COLI", "INTESTINAL ENTEROKOK"):
            continue
        try:
            sid = int(row["ISTASYON_NUMARASI"])
        except (KeyError, ValueError):
            continue
        day = row.get("OLCUM_TARIHI") or ""
        cur = latest.setdefault(sid, {"date": ""})
        if day > cur["date"]:
            latest[sid] = cur = {"date": day}
        if day == cur["date"]:
            cur["ecoli" if kind == "ESCHERICHIA COLI" else "entero"] = _count(row.get("OLCUM_DEGERI"))
    items = []
    for sid, (name, lat, lng) in GULF_STATIONS.items():
        m = latest.get(sid)
        if not m:
            continue
        label, color = water_level(m.get("ecoli"), m.get("entero"))
        items.append({
            "id": f"korfez-{sid}", "name": f"Körfez ölçümü: {name}", "lat": lat, "lng": lng,
            "ilce": None, "mahalle": None, "address": "", "note": "",
            "type": "korfez", "date": m["date"], "ecoli": m.get("ecoli"), "entero": m.get("entero"),
            "level": label, "levelColor": color,
        })
    return items


async def deniz(client: httpx.AsyncClient) -> list[Item]:
    results = await asyncio.gather(cbs(client, "plajlar"), cbs(client, "mavibayrakplajlar"), _gulf(client), return_exceptions=True)
    plaj, mavi, gulf = (x if isinstance(x, list) else [] for x in results)
    if not (plaj or mavi):
        raise SourceError("plaj servisleri yanıt vermedi")
    beaches: list[Item] = []
    for it in mavi:
        it.update(type="plaj", blueFlag=True, operator=(it["note"] or "").replace("Yerel Sorumlu Kuruluş:", "").strip() or None)
        beaches.append(it)
    for it in plaj:
        # Aynı plaj iki listede de olabilir: 250 m içindeki mavi bayraklı kayıt varsa tekrar eklenmez.
        if any(haversine(it["lat"], it["lng"], b["lat"], b["lng"]) < 250 for b in mavi):
            continue
        it.update(type="plaj", blueFlag=False, operator=None)
        beaches.append(it)
    return beaches + gulf


# ---------- Hal fiyatları ----------

HAL_KINDS = {"SEBZE": "Sebze", "MEYVE": "Meyve", "İTHAL": "İthal", "BALIK": "Balık"}
HAL_ORDER = ["Sebze", "Meyve", "İthal", "Balık"]


async def _hal_day(client: httpx.AsyncClient, kind: str, max_back: int = 7) -> tuple[str | None, list[dict]]:
    """Bugünden geriye doğru ilk bülteni bulur (hafta sonu ve tatillerde bülten yayımlanmaz)."""
    for i in range(max_back):
        d = (date.today() - timedelta(days=i)).isoformat()
        try:
            r = await client.get(f"{API}/ibb/halfiyatlari/{kind}/{d}", timeout=20)
        except httpx.HTTPError:
            continue
        if r.status_code != 200 or not r.content:
            continue
        try:
            data = r.json()
        except ValueError:
            continue
        rows = data.get("HalFiyatListesi") if isinstance(data, dict) else data
        if rows:
            return (data.get("BultenTarihi") if isinstance(data, dict) else None) or d, rows
    return None, []


async def hal_fiyatlari(client: httpx.AsyncClient) -> list[Item]:
    (veg_date, veg), (fish_date, fish) = await asyncio.gather(_hal_day(client, "sebzemeyve"), _hal_day(client, "balik"))
    if not veg and not fish:
        raise SourceError("son 7 günde hal bülteni bulunamadı")
    items = []
    for rows, day, default_kind in ((veg, veg_date, "Sebze"), (fish, fish_date, "Balık")):
        for x in rows:
            avg, lo, hi = num(x.get("OrtalamaUcret")), num(x.get("AsgariUcret")), num(x.get("AzamiUcret"))
            if avg is None and lo is None:
                continue
            kind = HAL_KINDS.get((x.get("MalTipAdi") or "").strip().upper(), default_kind)
            items.append({
                "id": f"hal-{default_kind}-{x.get('MalId')}-{title_case(x.get('MalAdi'))}",
                "name": title_case(x.get("MalAdi")),
                "lat": None, "lng": None,
                "kind": kind,
                "unit": title_case(x.get("Birim")) or "",
                "price": {"min": lo, "max": hi, "avg": avg},
                "date": day,
            })
    items.sort(key=lambda it: (HAL_ORDER.index(it["kind"]) if it["kind"] in HAL_ORDER else 9, tr_lower(it["name"])))
    return items


def fmt_tl(v: float | None) -> str | None:
    if v is None:
        return None
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s.removesuffix(',00')} ₺"

