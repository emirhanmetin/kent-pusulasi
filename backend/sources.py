"""İzBB açık veri servislerinden veri çekme ve ortak şemaya dönüştürme.

Ortak öğe şeması: {id, name, lat, lng, ilce, mahalle, address, phone, note, ...kaynağa özel alanlar}
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

import httpx

from .text import parse_market_days, pm10_level, title_case

API = "https://openapi.izmir.bel.tr/api"

Item = dict[str, Any]


class SourceError(Exception):
    """Servise ulaşılamadı ya da servis hata döndürdü (mesaj kullanıcıya gösterilir)."""


async def fetch_json(client: httpx.AsyncClient, path: str, timeout: float = 30) -> Any:
    try:
        r = await client.get(f"{API}{path}", timeout=timeout)
        r.raise_for_status()
        return r.json()
    except httpx.TimeoutException as e:
        raise SourceError("zaman aşımı") from e
    except httpx.HTTPStatusError as e:
        raise SourceError(f"HTTP {e.response.status_code}") from e
    except httpx.RequestError as e:
        raise SourceError("bağlantı hatası") from e
    except ValueError as e:
        raise SourceError("geçersiz yanıt") from e


def num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def has_coords(it: Item) -> bool:
    return bool(it.get("lat")) and bool(it.get("lng"))


def pick(o: dict, *keys: str) -> Any:
    for k in keys:
        if o.get(k) not in (None, ""):
            return o[k]
    return None


async def cbs(client: httpx.AsyncClient, name: str) -> list[Item]:
    """Kent Bilgi Sistemi "önemli yer" servisleri (toplanma alanı, taksi, pazar, WizmirNET...) aynı şemayı kullanır."""
    d = await fetch_json(client, f"/ibb/cbs/{name}")
    items = []
    for i, x in enumerate(d.get("onemliyer") or []):
        address = " ".join(p for p in (title_case(x.get("YOL")), f"No: {x['KAPINO']}" if x.get("KAPINO") else "") if p)
        it = {
            "id": f"{name}-{i}",
            "name": re.sub(r"\bNo['’]?\s?Lu\b", "Nolu", title_case(x.get("ADI"))),  # "No Lu", "No'Lu" -> "Nolu"
            "lat": num(x.get("ENLEM")),
            "lng": num(x.get("BOYLAM")),
            "ilce": title_case(x.get("ILCE")),
            "mahalle": title_case(x.get("MAHALLE")),
            "address": address,
            "note": re.sub(r"\s+", " ", x.get("ACIKLAMA") or "").strip(),
        }
        if has_coords(it):
            items.append(it)
    return items


async def nobetci_eczaneler(client: httpx.AsyncClient) -> list[Item]:
    d = await fetch_json(client, "/ibb/nobetcieczaneler")
    items = []
    for i, x in enumerate(d):
        it = {
            "id": f"eczane-{x.get('EczaneId')}-{i}",
            "name": title_case(x.get("Adi")),
            # Dikkat: bu serviste LokasyonX = enlem, LokasyonY = boylam.
            "lat": num(x.get("LokasyonX")),
            "lng": num(x.get("LokasyonY")),
            "ilce": title_case(x.get("Bolge")),
            "address": title_case(x.get("Adres")),
            "phone": x.get("Telefon"),
            "note": title_case(x.get("BolgeAciklama")),
            "dataDate": x.get("Tarih"),
        }
        if has_coords(it):
            items.append(it)
    return items


async def pazar_yerleri(client: httpx.AsyncClient) -> list[Item]:
    items = await cbs(client, "pazaryerleri")
    for it in items:
        it["days"] = parse_market_days(f"{it['note']} {it['name']}")
    return items


# Hava Kalitesi Ölçüm İstasyonları Konum Verisi (portaldaki CSV; bolge = servisteki BolgeId)
AIR_STATIONS = [
    {"bolge": 1, "name": "Alsancak", "ilce": "Konak", "lat": 38.432222, "lng": 27.144444},
    {"bolge": 2, "name": "Bornova", "ilce": "Bornova", "lat": 38.469167, "lng": 27.221389},
    {"bolge": 3, "name": "Güzelyalı", "ilce": "Konak", "lat": 38.395833, "lng": 27.082778},
    {"bolge": 4, "name": "Karşıyaka", "ilce": "Karşıyaka", "lat": 38.454167, "lng": 27.109722},
    {"bolge": 5, "name": "Şirinyer", "ilce": "Buca", "lat": 38.3825, "lng": 27.148333},
    {"bolge": 6, "name": "Çiğli", "ilce": "Çiğli", "lat": 38.498056, "lng": 27.067778},
    {"bolge": 7, "name": "Bayraklı", "ilce": "Bayraklı", "lat": 38.462222, "lng": 27.166667},
    {"bolge": 8, "name": "Güzelbahçe", "ilce": "Güzelbahçe", "lat": 38.373503, "lng": 26.88908},
    {"bolge": 9, "name": "Bergama", "ilce": "Bergama", "lat": 39.111034, "lng": 27.191878},
]


async def hava_kalitesi(client: httpx.AsyncClient) -> list[Item]:
    # Servis tarih parametresi alıyor; bugünün verisi henüz yoksa geriye doğru deneniyor.
    values = None
    for i in range(5):
        ds = (date.today() - timedelta(days=i)).isoformat()
        try:
            arr = await fetch_json(client, f"/ibb/cevre/havadegerleri/{ds}")
        except SourceError:
            continue
        if isinstance(arr, list) and any(v.get("OlcumDegeri") not in ("", None) for v in arr):
            values = arr
            break
    if values is None:
        raise SourceError("son 5 günde ölçüm bulunamadı")

    items = []
    for s in AIR_STATIONS:
        vs = [v for v in values if v.get("BolgeId") == s["bolge"]]
        gas = {v.get("GazAdi"): num(v.get("OlcumDegeri")) for v in vs}
        pm10 = gas.get("PM10")
        items.append({
            "id": f"hava-{s['bolge']}",
            **s,
            "pm10": pm10,
            "so2": gas.get("SO2"),
            "date": vs[0].get("OlcumTarihi") if vs else None,
            "level": pm10_level(pm10),
        })
    return items
