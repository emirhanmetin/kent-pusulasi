"""Taksi durakları ve telefon numaraları.

Belediyenin taksi durağı verisinde (CBS "taksiduraklari") telefon yok. Numara iki kaynaktan eklenir:

  1. data/taksi_telefonlari.csv: elle doğrulanmış numaralar (durak sahiplerinden, Taksiciler Odası'ndan...).
     Her zaman önceliklidir. Biçim: ilce;durak;telefon   (ör. Bayraklı;Adliye Taksi Durağı;0232 123 45 67)
  2. OpenStreetMap: "amenity=taxi" noktalarındaki phone etiketi. Belediye durağına 150 m'den yakınsa ya da
     adı aynıysa ve 500 m içindeyse eşleştirilir. Gönüllü verisidir, "doğrulanmamış" diye gösterilir.

OpenStreetMap'e ulaşılamazsa duraklar yine listelenir (yalnızca o kaynaktan gelen numaralar eksik kalır).
"""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from .areas import norm
from .geo import haversine
from .sources import cbs

log = logging.getLogger("kent.taksi")
Item = dict[str, Any]

CURATED = Path(__file__).resolve().parent / "data" / "taksi_telefonlari.csv"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
_BBOX = (38.15, 26.55, 38.80, 27.55)  # güney, batı, kuzey, doğu (bkz. parking.py)
_QUERY = f'[out:json][timeout:60];nwr["amenity"="taxi"]{_BBOX};out tags center;'
NEAR_M, SAME_NAME_M = 150, 500

SOURCE_CURATED = "Doğrulanmış liste"
SOURCE_OSM = "OpenStreetMap (doğrulanmamış)"


def normalize_phone(raw: str | None) -> str | None:
    """'+90 232 467 00 07' / '232 4670007' / '0 (232) 467-00-07' -> '02324670007'; geçersizse None."""
    d = re.sub(r"\D", "", raw or "")
    if d.startswith("90") and len(d) == 12:
        d = d[2:]
    if len(d) == 10:
        d = "0" + d
    return d if len(d) == 11 and d.startswith("0") else None


def stand_key(name: str | None) -> str:
    """'Adliye Taksi Durağı' ve 'Adliye Taksi' aynı anahtarı verir."""
    t = norm(name)
    return re.sub(r"(taksidura[gğ]ı?|taksidurak|taksi|durağı|durak)", "", t)


def load_curated(path: Path = CURATED) -> dict[tuple[str, str], str]:
    """(ilçe, durak anahtarı) -> telefon. Dosya yoksa ya da satır hatalıysa sessizce atlanır."""
    out: dict[tuple[str, str], str] = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) < 3 or row[0].startswith("#") or row[0].strip().lower() == "ilce":
                continue
            phone = normalize_phone(row[2])
            if phone:
                out[(norm(row[0]), stand_key(row[1]))] = phone
    return out


async def _osm_phones(client: httpx.AsyncClient) -> list[Item]:
    for url in OVERPASS:
        try:
            r = await client.post(url, data={"data": _QUERY}, timeout=120)
            r.raise_for_status()
            elements = r.json()["elements"]
            break
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("Overpass başarısız (%s): %s", url, e)
    else:
        return []
    out = []
    for e in elements:
        tags = e.get("tags") or {}
        phone = normalize_phone(tags.get("phone") or tags.get("contact:phone") or tags.get("contact:mobile"))
        lat = e.get("lat", (e.get("center") or {}).get("lat"))
        lng = e.get("lon", (e.get("center") or {}).get("lon"))
        if phone and lat is not None and lng is not None:
            out.append({"name": tags.get("name"), "lat": lat, "lng": lng, "phone": phone})
    return out


def attach_phones(stands: list[Item], curated: dict[tuple[str, str], str], osm: list[Item]) -> list[Item]:
    open_stands = []
    for it in stands:
        phone = curated.get((norm(it.get("ilce")), stand_key(it.get("name"))))
        if phone:
            it["phone"], it["phoneSource"] = phone, SOURCE_CURATED
        else:
            open_stands.append(it)

    # Aday eşleşmeler en yakından başlayarak dağıtılır: her OSM numarası tek bir durağa gider
    # (yan yana iki durak aynı numarayı almasın), her durak en yakın uygun numarayı alır.
    pairs = []
    for si, it in enumerate(open_stands):
        key = stand_key(it.get("name"))
        for oi, o in enumerate(osm):
            d = haversine(it["lat"], it["lng"], o["lat"], o["lng"])
            if d <= NEAR_M or (d <= SAME_NAME_M and key and stand_key(o.get("name")) == key):
                pairs.append((d, si, oi))
    used_stands, used_osm = set(), set()
    for _, si, oi in sorted(pairs):
        if si in used_stands or oi in used_osm:
            continue
        used_stands.add(si)
        used_osm.add(oi)
        open_stands[si]["phone"], open_stands[si]["phoneSource"] = osm[oi]["phone"], SOURCE_OSM
    return stands


async def taksi_duraklari(client: httpx.AsyncClient) -> list[Item]:
    stands = await cbs(client, "taksiduraklari")
    osm = await _osm_phones(client)
    stands = attach_phones(stands, load_curated(), osm)
    log.info("Taksi durakları: %d durak, %d telefonlu (OSM'de %d numara)", len(stands), sum(1 for s in stands if s.get("phone")), len(osm))
    return stands
