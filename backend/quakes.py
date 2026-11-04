"""Son depremler: AFAD Deprem Dairesi'nin herkese açık deprem listesi servisi.

İzmir ve çevresini kapsayan kutu içinde son 7 günün depremleri (M1.5+) alınır, en yeniden eskiye sıralanır.
Kaynak gösterimi: "AFAD Deprem Dairesi Başkanlığı".
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .sources import SourceError, num
from .text import MONTHS, title_case

AFAD_URL = "https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter"
BBOX = {"minlat": 37.5, "maxlat": 39.8, "minlon": 25.8, "maxlon": 28.9}  # İzmir ve çevresi
DAYS = 7
MIN_MAG = 1.5
TR_TZ = timezone(timedelta(hours=3))

Item = dict[str, Any]


def magnitude_color(m: float | None) -> str:
    if m is None or m < 2.5:
        return "#8e8e93"
    if m < 4:
        return "#ff9500"
    if m < 5:
        return "#ff3b30"
    return "#a2281e"


def km(v: float | None) -> str | None:
    """7 -> '7 km', 10.65 -> '10,7 km'"""
    if v is None:
        return None
    return f"{v:.1f}".removesuffix(".0").replace(".", ",") + " km"


def clean_place(text: str | None) -> str:
    """'Ege Denizi - Kuşadası Körfezi - [07.74 km] Kuşadası (Aydın)' -> 'Ege Denizi - Kuşadası Körfezi - Kuşadası (Aydın)'"""
    return re.sub(r"\s*\[[^\]]*\]\s*", " ", text or "").strip()


def ago(dt: datetime) -> str:
    s = (datetime.now(TR_TZ) - dt).total_seconds()
    if s < 3600:
        return f"{max(1, round(s / 60))} dk önce"
    if s < 86400:
        return f"{round(s / 3600)} sa önce"
    return f"{dt.day} {MONTHS[dt.month - 1]} {dt:%H:%M}"


async def son_depremler(client: httpx.AsyncClient) -> list[Item]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=DAYS)
    params = {
        **BBOX,
        "start": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "end": end.strftime("%Y-%m-%dT%H:%M:%S"),
        "minmag": MIN_MAG,
        "format": "json",
    }
    try:
        r = await client.get(AFAD_URL, params=params, timeout=30)
        r.raise_for_status()
        rows = r.json()
    except httpx.TimeoutException as e:
        raise SourceError("AFAD zaman aşımı") from e
    except httpx.HTTPStatusError as e:
        raise SourceError(f"AFAD HTTP {e.response.status_code}") from e
    except (httpx.HTTPError, ValueError) as e:
        raise SourceError("AFAD'a ulaşılamadı") from e

    items = []
    for x in rows if isinstance(rows, list) else []:
        mag, lat, lng = num(x.get("magnitude")), num(x.get("latitude")), num(x.get("longitude"))
        if lat is None or lng is None:
            continue
        try:
            # AFAD saatleri UTC verir
            when = datetime.fromisoformat(x["date"]).replace(tzinfo=timezone.utc).astimezone(TR_TZ)
        except (KeyError, ValueError):
            continue
        place = clean_place(x.get("location")) or title_case(x.get("district"))
        items.append({
            "id": f"deprem-{x.get('eventID')}",
            "name": f"M {mag:.1f} · {place}" if mag is not None else place,
            "lat": lat,
            "lng": lng,
            "ilce": title_case(x.get("district")),
            "mahalle": title_case(x.get("neighborhood")),
            "il": x.get("province"),
            "magnitude": mag,
            "magType": x.get("type"),
            "depth": num(x.get("depth")),
            "time": when.isoformat(),
            "place": place,
        })
    items.sort(key=lambda it: it["time"], reverse=True)
    return items


def age_hours(it: Item) -> float:
    return (datetime.now(TR_TZ) - datetime.fromisoformat(it["time"])).total_seconds() / 3600


def when_text(it: Item) -> str:
    return ago(datetime.fromisoformat(it["time"]))
