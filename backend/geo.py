"""Konum servisi: mesafe hesabı, bölge (mahalle) tahmini ve IP tabanlı yaklaşık konum."""

from __future__ import annotations

import ipaddress
import logging
import math
import time
from typing import Any, Iterable

import httpx

log = logging.getLogger("kent.geo")

DEFAULT_LAT, DEFAULT_LNG = 38.4189, 27.1287  # Konak Meydanı
IZMIR_BBOX = (37.8, 26.1, 39.45, 28.55)  # güney, batı, kuzey, doğu


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """İki nokta arası kuş uçuşu mesafe (metre)."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def fmt_dist(m: float) -> str:
    if m < 1000:
        return f"{round(m / 10) * 10} m"
    s = f"{m / 1000:.1f}".removesuffix(".0")
    return f"{s.replace('.', ',')} km"


def fmt_duration(sec: float) -> str:
    m = max(1, round(sec / 60))
    return f"{m} dk" if m < 60 else f"{m // 60} sa {m % 60} dk"


def in_izmir(lat: float, lng: float) -> bool:
    s, w, n, e = IZMIR_BBOX
    return s <= lat <= n and w <= lng <= e


def with_distance(items: Iterable[dict[str, Any]], lat: float, lng: float) -> list[tuple[dict[str, Any], float | None]]:
    """Öğeleri mesafeleriyle birlikte yakından uzağa sıralar. Koordinatsız öğeler sona gider."""
    out = [
        (it, haversine(lat, lng, it["lat"], it["lng"]) if it.get("lat") is not None and it.get("lng") is not None else None)
        for it in items
    ]
    out.sort(key=lambda p: math.inf if p[1] is None else p[1])
    return out


def nearest_area(points: list[dict[str, Any]], lat: float, lng: float, max_m: float = 3000) -> dict | None:
    """Ters coğrafi kodlama: mahalle bilgisi olan en yakın noktadan bölge tahmini.

    Toplanma alanları (~2.400 nokta, her mahallede birkaç tane) bu iş için iyi bir yaklaşık veriyor.
    Gerçek mahalle sınırı poligonları eklendiğinde burası nokta-içinde-poligon testine dönüşmeli.
    """
    best, best_d = None, math.inf
    for p in points:
        if not p.get("mahalle"):
            continue
        d = haversine(lat, lng, p["lat"], p["lng"])
        if d < best_d:
            best, best_d = p, d
    if best is None or best_d > max_m:
        return None
    return {"mahalle": best["mahalle"], "ilce": best["ilce"], "mesafe": round(best_d)}


# ---------- IP tabanlı yaklaşık konum ----------

_IP_CACHE: dict[str, tuple[float, dict]] = {}
_IP_TTL = 600


def _is_public(ip: str | None) -> bool:
    try:
        return ipaddress.ip_address(ip or "").is_global
    except ValueError:
        return False


async def ip_location(client: httpx.AsyncClient, ip: str | None) -> dict:
    """Tarayıcı konumu alınamadığında kullanılan şehir düzeyinde yaklaşık konum.

    Sunucu yerelde çalışırken istek 127.0.0.1'den gelir; bu durumda sunucunun kendi dış IP'si
    sorgulanır (yerel kullanımda bu, kullanıcının bağlantısıdır). Yayında gerçek istemci IP'si kullanılır.
    Not: Türkiye'de bazı operatörler IP'yi İstanbul/Ankara'da gösterebilir; bu yüzden sonuç yalnızca
    İzmir sınırları içindeyse kullanılmalı (bkz. 'izmirde').
    """
    key = ip if _is_public(ip) else "self"
    cached = _IP_CACHE.get(key)
    if cached and time.time() - cached[0] < _IP_TTL:
        return cached[1]

    suffix = ip if key != "self" else ""
    providers = (
        (f"https://ipwho.is/{suffix}", lambda d: d.get("success") and (d["latitude"], d["longitude"], d.get("city"), d.get("region"))),
        (f"https://ipapi.co/{suffix + '/' if suffix else ''}json/", lambda d: not d.get("error") and (d["latitude"], d["longitude"], d.get("city"), d.get("region"))),
    )
    for url, parse in providers:
        try:
            r = await client.get(url, timeout=8)
            r.raise_for_status()
            parsed = parse(r.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            # Adres ve hata metni kullanıcının IP adresini içerir; yalnızca servis adı ve hata türü yazılır.
            log.warning("IP konum servisi başarısız (%s): %s", url.split("/")[2], type(e).__name__)
            continue
        if not parsed or parsed[0] is None:
            continue
        lat, lng, city, region = parsed
        result = {
            "lat": float(lat),
            "lng": float(lng),
            "accuracy": 15000,  # IP konumu şehir düzeyindedir; kabaca 15 km
            "sehir": city or region or "bilinmiyor",
            "izmirde": in_izmir(float(lat), float(lng)),
            "source": "ip",
        }
        _IP_CACHE[key] = (time.time(), result)
        return result
    raise LookupError("IP konum servislerine ulaşılamadı")
