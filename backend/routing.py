"""Yol mesafesi ve rota: OSRM (OpenStreetMap verisiyle çalışan açık kaynak rota motoru).

Tüm kayıtlar için yol mesafesi hesaplamak pahalı (toplanma alanı: 2.380 nokta). Bu yüzden:
  1. Kuş uçuşu mesafeyle en yakın N aday seçilir (yol mesafesi hiçbir zaman kuş uçuşundan kısa olamaz).
  2. Bu adayların araç mesafesi/süresi OSRM "table" servisinden TEK istekte alınır.
  3. Adaylar yol mesafesine göre yeniden sıralanır; kalanlar kuş uçuşu sırasıyla arkaya eklenir.

Şu an FOSSGIS'in ücretsiz genel sunucusu kullanılıyor (adil kullanım koşuluyla). Yayına çıkarken
kendi OSRM sunucunuzu kurun: docker + Türkiye OSM verisi (bkz. README).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from . import config

log = logging.getLogger("kent.routing")

# Ücretsiz genel sunucular: yalnızca geliştirmede (config.PUBLIC_ROUTING). FOSSGIS kuralı: saniyede en fazla
# 1 istek, yoğun kullanım yok, atıf zorunlu. Yayında kendi OSRM sunucunuzu kullanın (OSRM_URL, OSRM_FOOT_URL).
PUBLIC_SERVERS = {
    "driving": ["https://routing.openstreetmap.de/routed-car"],
    "walking": ["https://routing.openstreetmap.de/routed-foot"],
}
PUBLIC_MIN_INTERVAL = 1.1  # saniye
_public_lock = asyncio.Lock()
_public_last = 0.0


def servers(profile: str) -> list[str]:
    own = {"driving": config.OSRM_CAR_URL, "walking": config.OSRM_FOOT_URL}.get(profile)
    return ([own] if own else []) + (PUBLIC_SERVERS.get(profile, []) if config.PUBLIC_ROUTING else [])


async def _throttle_public(url: str) -> None:
    """Genel sunuculara istekleri saniyede en fazla bir taneye indirir."""
    global _public_last
    if not any(url.startswith(p) for ps in PUBLIC_SERVERS.values() for p in ps):
        return
    async with _public_lock:
        wait = PUBLIC_MIN_INTERVAL - (time.monotonic() - _public_last)
        if wait > 0:
            await asyncio.sleep(wait)
        _public_last = time.monotonic()
CANDIDATES = 25  # yol mesafesi hesaplanacak en yakın aday sayısı
CACHE_TTL = 3600
CACHE_MAX = 50_000

Item = dict[str, Any]


class RoutingError(Exception):
    pass


@dataclass
class Distance:
    """Bir kaydın kullanıcıya uzaklığı. road/duration yoksa yalnızca kuş uçuşu biliniyor demektir."""

    air: float
    road: float | None = None
    duration: float | None = None  # saniye, trafiksiz
    profile: str = "driving"  # driving | walking

    @property
    def sort_key(self) -> float:
        return self.road if self.road is not None else self.air


_cache: dict[tuple, tuple[float, Any]] = {}


def _pt(lat: float, lng: float) -> tuple[float, float]:
    # ~10 m hassasiyet: yakın konumlar aynı önbellek kaydını kullanır
    return (round(lat, 4), round(lng, 4))


def _cache_get(key: tuple) -> Any:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    return None


def _cache_set(key: tuple, value: Any) -> None:
    if len(_cache) > CACHE_MAX:
        _cache.clear()
    _cache[key] = (time.time(), value)


async def _osrm(client: httpx.AsyncClient, profile: str, service: str, coords: list[tuple[float, float]], params: dict) -> dict:
    path = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in coords)
    last_error = "rota sunucusu tanımlı değil"
    for base in servers(profile):
        try:
            await _throttle_public(base)
            r = await client.get(f"{base}/{service}/v1/driving/{path}", params=params, timeout=20)
            r.raise_for_status()
            data = r.json()
            if data.get("code") != "Ok":
                raise RoutingError(data.get("message") or data.get("code"))
            return data
        except (httpx.HTTPError, ValueError, RoutingError) as e:
            last_error = _safe_error(e)
            log.warning("OSRM %s başarısız (%s): %s", service, base, last_error)
    raise RoutingError(last_error)


def _safe_error(e: Exception) -> str:
    """Hata metni. httpx'in mesajı istek adresini (yani kullanıcı koordinatlarını) içerir; günlüğe ve
    kullanıcıya yalnızca durum kodu / hata türü verilir."""
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    if isinstance(e, httpx.TimeoutException):
        return "zaman aşımı"
    if isinstance(e, httpx.HTTPError):
        return type(e).__name__
    return str(e) if isinstance(e, RoutingError) else type(e).__name__


async def road_distances(
    client: httpx.AsyncClient, origin: tuple[float, float], dests: list[tuple[float, float]], profile: str = "driving"
) -> list[tuple[float | None, float | None]]:
    """Başlangıçtan her hedefe (yol mesafesi m, süre sn). Ulaşılamayan hedefler için (None, None)."""
    o = _pt(*origin)
    out: list[tuple[float | None, float | None] | None] = [_cache_get((profile, o, _pt(*d))) for d in dests]
    missing = [i for i, v in enumerate(out) if v is None]
    if missing:
        data = await _osrm(
            client, profile, "table", [origin] + [dests[i] for i in missing], {"sources": "0", "annotations": "distance,duration"}
        )
        dist, dur = data["distances"][0][1:], data["durations"][0][1:]
        for j, i in enumerate(missing):
            out[i] = (dist[j], dur[j])
            _cache_set((profile, o, _pt(*dests[i])), out[i])
    return out  # type: ignore[return-value]


async def rank(
    client: httpx.AsyncClient,
    pairs: list[tuple[Item, float | None]],
    origin: tuple[float, float],
    profile: str = "driving",
    candidates: int = CANDIDATES,
) -> tuple[list[tuple[Item, Distance | None]], str | None]:
    """Kuş uçuşuna göre sıralı (öğe, mesafe) listesini, en yakın adaylar için yol mesafesiyle yeniden sıralar.

    Dönüş: (sıralı liste, hata mesajı). Rota servisi çalışmazsa kuş uçuşu sırası korunur ve hata döner.
    """
    located = [(it, Distance(air=d)) for it, d in pairs if d is not None]
    unlocated = [(it, None) for it, d in pairs if d is None]
    head, tail = located[:candidates], located[candidates:]
    error = None
    if head:
        try:
            roads = await road_distances(client, origin, [(it["lat"], it["lng"]) for it, _ in head], profile)
            for (_, dist), (road, dur) in zip(head, roads):
                dist.road, dist.duration, dist.profile = road, dur, profile
            # Yola ulaşılamayanlar (ör. adadaki nokta) adayların sonuna
            head.sort(key=lambda p: (p[1].road is None, p[1].sort_key))
        except RoutingError as e:
            error = f"Yol mesafesi alınamadı ({e}); kuş uçuşu gösteriliyor."
    return head + tail + unlocated, error


async def route(client: httpx.AsyncClient, origin: tuple[float, float], dest: tuple[float, float], profile: str = "driving") -> dict:
    """İki nokta arası rota: mesafe, süre ve haritada çizilecek [enlem, boylam] listesi."""
    key = ("route", profile, _pt(*origin), _pt(*dest))
    cached = _cache_get(key)
    if cached:
        return cached
    data = await _osrm(client, profile, "route", [origin, dest], {"overview": "full", "geometries": "geojson"})
    r = data["routes"][0]
    result = {
        "mesafe": r["distance"],
        "sure": r["duration"],
        "koordinatlar": [[lat, lng] for lng, lat in r["geometry"]["coordinates"]],
    }
    _cache_set(key, result)
    return result
