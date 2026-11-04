"""Otoparklar: dört kaynağın birleşimi.

1. İzelman envanteri (açık veri portalı CSV'leri): 95 otopark; konum, tür, kapasite, çalışma saati.
   Kapalı/katlı, açık alan, yol kenarı ve aboneli olmak üzere 4 dosya.
2. İzelman canlı doluluk (openapi /ibb/izum/otoparklar): yalnızca ~8 otopark; envanterle konumdan eşleştirilir.
3. İzelman ücret tarifesi (portal CSV): otopark adından eşleştirilir.
4. OpenStreetMap (Overpass): belediye dışı otoparklar (AVM, hastane, açık alan...). Doğrulanmamış
   kabul edilir; İzelman otoparklarına çok yakın olanlar tekrar sayılmasın diye atılır.

Değişmeyen kaynaklar (1, 3, 4) günde bir, canlı doluluk her yenilemede çekilir.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import time
from datetime import datetime
from typing import Any, Awaitable, Callable

import httpx

from .geo import haversine
from .sources import SourceError, fetch_json, has_coords, num
from .text import title_case, tr_lower

log = logging.getLogger("kent.parking")

Item = dict[str, Any]
CKAN = "https://acikveri.bizizmir.com/api/3/action/package_show"
INVENTORY_DATASET = "izelman-otopark-lokasyon-kapasite-ve-calisma-saati-verisi"
FEES_DATASET = "otopark-ucretleri"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
STATIC_TTL = 86400

_static: dict[str, tuple[float, Any]] = {}


async def _cached(key: str, loader: Callable[[], Awaitable[Any]]) -> Any:
    """Değişmeyen kaynakları günde bir çeker; çekemezse varsa eski kopyayı kullanır."""
    hit = _static.get(key)
    if hit and time.time() - hit[0] < STATIC_TTL:
        return hit[1]
    try:
        value = await loader()
    except (SourceError, httpx.HTTPError, ValueError, KeyError) as e:
        if hit:
            log.warning("%s yenilenemedi, eski kopya kullanılıyor: %s", key, e)
            return hit[1]
        raise
    _static[key] = (time.time(), value)
    return value


# ---------- CSV (portal) ----------


async def _dataset_csvs(client: httpx.AsyncClient, dataset: str) -> dict[str, list[dict]]:
    """Portaldaki bir veri setinin CSV kaynaklarını {dosya adı: satırlar} olarak döndürür.

    Kaynak adresleri sabit yazılmıyor; veri seti güncellenip adresler değişse de çalışsın diye
    CKAN API'sinden okunuyor.
    """
    r = await client.get(CKAN, params={"id": dataset}, timeout=30)
    r.raise_for_status()
    out = {}
    for res in r.json()["result"]["resources"]:
        url = res.get("url") or ""
        if not url.lower().endswith(".csv"):
            continue
        f = await client.get(url, timeout=30)
        f.raise_for_status()
        raw = f.content
        text = raw.decode("utf-8-sig") if raw[:3] == b"\xef\xbb\xbf" or _is_utf8(raw) else raw.decode("cp1254")
        header = text.split("\n", 1)[0]
        delim = ";" if header.count(";") > header.count(",") else ","
        out[url.rsplit("/", 1)[-1]] = list(csv.DictReader(io.StringIO(text), delimiter=delim))
    return out


def _is_utf8(raw: bytes) -> bool:
    try:
        raw.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


# Dosya adına göre otopark türü
KINDS = [
    ("kapali", "Kapalı / katlı otopark"),
    ("disinda-acik", "Açık alan otoparkı"),
    ("aboneli", "Aboneli otopark (bariyerli)"),
    ("yol-kenari", "Yol kenarı otoparkı"),
]


def _kind_of(filename: str) -> str:
    f = filename.lower()
    for key, label in KINDS:
        if key in f:
            return label
    return "Otopark"


def _hours(open_: str | None, close: str | None) -> tuple[str | None, tuple[int, int] | None]:
    """('07:00–21:00', (420, 1260)) gibi; 00:00–24:00 ise ('7/24', (0, 1440))."""
    def mins(s):
        m = re.match(r"^\s*(\d{1,2})[:.](\d{2})", s or "")
        return int(m.group(1)) * 60 + int(m.group(2)) if m else None

    a, b = mins(open_), mins(close)
    if a is None or b is None:
        return None, None
    if a == 0 and b in (0, 1440):
        return "7/24", (0, 1440)
    return f"{open_.strip()}–{close.strip()}", (a, b)


def is_open_now(window: tuple[int, int] | list | None) -> bool | None:
    if not window:
        return None
    a, b = window
    now = datetime.now()
    m = now.hour * 60 + now.minute
    return a <= m < b if a < b else (m >= a or m < b)  # gece yarısını aşan saatler


async def _inventory(client: httpx.AsyncClient) -> list[Item]:
    files = await _dataset_csvs(client, INVENTORY_DATASET)
    items = []
    for fname, rows in files.items():
        kind = _kind_of(fname)
        for i, r in enumerate(rows):
            name = r.get("OTOPARK_ADI") or (f"Sahil Bulvarı {r['BLOK_ADI']} Blok" if r.get("BLOK_ADI") else "Otopark")
            hours_text, window = _hours(r.get("ACILIS_SAATI"), r.get("KAPANIS_SAATI"))
            address = " · ".join(p for p in (r.get("ADRES") or r.get("ADRES_VEYA_TARIF"), r.get("YER_TARIFI") or r.get("EK_BILGI")) if p)
            it = {
                "id": f"izelman-{fname.split('.')[0]}-{i}",
                "name": title_case(name),
                "lat": num(r.get("ENLEM")),
                "lng": num(r.get("BOYLAM")),
                "ilce": title_case(r.get("ILCE")),
                "mahalle": title_case(r.get("MAHALLE")),
                "address": title_case(address),
                "kind": kind,
                "capacity": int(num(r.get("KAPASITE")) or 0) or None,
                "hours": hours_text,
                "window": window,
                "provider": "İzelman",
                "source": "izelman",
            }
            if has_coords(it):
                items.append(it)
    return items


# ---------- Ücretler ----------

_FEE_STOP = {"otoparkı", "otopark", "otp", "otoparklari", "katlı", "yeraltı", "yer", "altı", "tam", "otomatik", "alanı", "açık", "ve"}
_FEE_FIX = [("symrna", "smyrna"), ("pazar yeri", "pazaryeri"), ("yer altı", "yeraltı"), ("yol altı", "yolaltı")]


def _tokens(name: str) -> set[str]:
    t = tr_lower(name)
    for a, b in _FEE_FIX:
        t = t.replace(a, b)
    return {w for w in re.findall(r"[a-zçğıöşü]+", t) if w not in _FEE_STOP and len(w) > 1}


def _fee_summary(row: dict) -> dict:
    def tl(v):
        return f"{int(v):,} ₺".replace(",", ".") if v and v.strip().isdigit() else None

    short = next(((k, row[k]) for k in ("0-1 Saat", "0-2 saat", "0-3 saat", "0-6 saat", "0-12 saat") if row.get(k)), None)
    long = next(((k, row[k]) for k in ("12-24 saat", "0-24 saat") if row.get(k)), None)
    parts = [f"{p[0].replace(' saat', ' sa').replace(' Saat', ' sa')} {tl(p[1])}" for p in (short, long) if p and tl(p[1])]
    night = next((f"{k.split(' Arası')[0]} {tl(row[k])}" for k in row if "Arası" in (k or "") and tl(row.get(k))), None)
    return {
        "fee": " · ".join(parts) or None,
        "feeNight": night,
        "feeMonthly": tl(row.get("Aylık Abone Ücreti")),
    }


async def _fees(client: httpx.AsyncClient) -> list[tuple[str, set[str], dict]]:
    files = await _dataset_csvs(client, FEES_DATASET)
    rows = next(iter(files.values()), [])
    out = []
    for r in rows:
        name_key = next(iter(r))
        name = re.sub(r"\s+", " ", r.get(name_key) or "").strip()
        if name:
            out.append((name, _tokens(name), _fee_summary(r)))
    return out


def _attach_fees(items: list[Item], fees: list[tuple[str, set[str], dict]]) -> None:
    generic = {n: f for n, _, f in fees}
    for it in items:
        tokens = _tokens(it["name"])
        best, score = None, 0.0
        for name, ftokens, fee in fees:
            if not tokens or not ftokens:
                continue
            s = len(tokens & ftokens) / len(tokens | ftokens)
            if s > score:
                best, score = fee, s
        if best and score >= 0.5:
            it.update(best)
        elif it["kind"].startswith("Açık alan") and "Açıkalan Otoparklar" in generic:
            it.update(generic["Açıkalan Otoparklar"])
        elif it["kind"].startswith("Aboneli"):
            monthly = next((f for n, f in generic.items() if n.startswith("Mustafa Kemal Sahil Bulvarı Bariyerli")), None)
            if monthly:
                it.update(monthly)


# ---------- Canlı doluluk ----------


async def _live(client: httpx.AsyncClient) -> list[dict]:
    d = await fetch_json(client, "/ibb/izum/otoparklar", timeout=60)
    out = []
    for x in d:
        total = (x.get("occupancy") or {}).get("total") or {}
        free, occupied = num(total.get("free")), num(total.get("occupied"))
        if x.get("lat") is None or free is None:
            continue
        out.append({
            "name": x.get("name"),
            "lat": float(x["lat"]),
            "lng": float(x["lng"]),
            "offstreet": x.get("type") != "OnStreet",
            "free": int(free),
            "occupied": int(occupied or 0),
            "open": x.get("status") == "Opened",
        })
    return out


def _attach_live(items: list[Item], live: list[dict]) -> list[Item]:
    """Canlı kaydı en yakın aynı tür envanter kaydına bağlar; eşleşmeyenleri ayrı kayıt olarak ekler."""
    extra = []
    for i, lv in enumerate(live):
        same_kind = [it for it in items if it["kind"].startswith("Yol kenarı") != lv["offstreet"]]
        best = min(same_kind, key=lambda it: haversine(lv["lat"], lv["lng"], it["lat"], it["lng"]), default=None)
        target = best if best and haversine(lv["lat"], lv["lng"], best["lat"], best["lng"]) < 150 else None
        if target is None:
            target = {
                "id": f"izelman-canli-{i}",
                "name": re.sub(r"^\d+\s+", "", lv["name"] or "Otopark"),
                "lat": lv["lat"],
                "lng": lv["lng"],
                "kind": "Kapalı / katlı otopark" if lv["offstreet"] else "Yol kenarı otoparkı",
                "provider": "İzelman",
                "source": "izelman",
                "capacity": None,
            }
            extra.append(target)
        target.update(free=lv["free"], occupied=lv["occupied"], live=True, liveOpen=lv["open"])
        target["capacity"] = lv["free"] + lv["occupied"]
    return items + extra


# ---------- OpenStreetMap ----------

# İl sınırı (area) sorgusu Overpass'ı zorlayıp 504 verebiliyor; metropol alanını kapsayan kutu daha hafif.
_OSM_BBOX = (38.15, 26.55, 38.80, 27.55)  # güney, batı, kuzey, doğu
_OSM_QUERY = f'[out:json][timeout:60];nwr["amenity"="parking"]{_OSM_BBOX};out tags center;'
_OSM_SKIP_ACCESS = {"private", "no", "permit", "delivery"}
_OSM_SKIP_NAME = re.compile(r"site|toki|lojman|oto yıkama|personel|sakinler", re.I)
_OSM_KIND = {
    "surface": "Açık otopark",
    "multi-storey": "Katlı otopark",
    "underground": "Yeraltı otoparkı",
    "street_side": "Yol kenarı park alanı",
    "lane": "Yol kenarı park alanı",
    "rooftop": "Çatı otoparkı",
}


async def _osm(client: httpx.AsyncClient) -> list[Item]:
    last = None
    for url in OVERPASS:
        try:
            r = await client.post(url, data={"data": _OSM_QUERY}, timeout=120)
            r.raise_for_status()
            elements = r.json()["elements"]
            break
        except (httpx.HTTPError, ValueError, KeyError) as e:
            last = e
            log.warning("Overpass başarısız (%s): %s", url, e)
    else:
        raise SourceError(f"OpenStreetMap otopark verisi alınamadı ({last})")

    items = []
    for e in elements:
        t = e.get("tags", {})
        name = t.get("name")
        if t.get("access") in _OSM_SKIP_ACCESS or (name and _OSM_SKIP_NAME.search(name)):
            continue
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lng = e.get("lon") or (e.get("center") or {}).get("lon")
        kind = _OSM_KIND.get(t.get("parking"), "Otopark")
        if t.get("access") == "customers":
            kind += " (müşterilere)"
        oh = t.get("opening_hours")
        items.append({
            "id": f"osm-{e['type']}-{e['id']}",
            "name": name or kind.split(" (")[0],
            "lat": lat,
            "lng": lng,
            "address": t.get("addr:street") or "OpenStreetMap · doğrulanmamış",
            "kind": kind,
            "capacity": int(num(t.get("capacity")) or 0) or None,
            "hours": "7/24" if oh == "24/7" else oh,
            "window": (0, 1440) if oh == "24/7" else None,
            "fee": {"yes": "Ücretli", "no": "Ücretsiz"}.get(t.get("fee")),
            "provider": t.get("operator"),
            "source": "osm",
        })
    return [it for it in items if it["lat"] and it["lng"]]


# ---------- Birleştirme ----------


async def otoparklar(client: httpx.AsyncClient) -> list[Item]:
    items = await _cached("izelman-envanter", lambda: _inventory(client))
    items = [dict(it) for it in items]  # önbellekteki kopyayı bozmamak için

    try:
        _attach_fees(items, await _cached("izelman-ucret", lambda: _fees(client)))
    except (SourceError, httpx.HTTPError, ValueError, KeyError) as e:
        log.warning("Otopark ücretleri alınamadı: %s", e)

    try:
        items = _attach_live(items, await _live(client))
    except SourceError as e:
        log.warning("Canlı doluluk alınamadı: %s", e)

    try:
        osm = await _cached("osm-otopark", lambda: _osm(client))
        izelman = [(it["lat"], it["lng"]) for it in items]
        items += [o for o in osm if all(haversine(o["lat"], o["lng"], a, b) > 80 for a, b in izelman)]
    except SourceError as e:
        log.warning("%s", e)

    for it in items:
        it.setdefault("live", False)
        it.setdefault("free", None)
    return items
