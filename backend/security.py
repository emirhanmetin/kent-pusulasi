"""İstek sınırı, gizlilik dostu erişim günlüğü ve güvenlik başlıkları."""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse

from . import config

log = logging.getLogger("kent.access")


def client_ip(request: Request) -> str | None:
    """İstemci IP'si. X-Forwarded-For yalnızca ters vekil arkasındayken (KP_TRUST_PROXY) dikkate alınır;
    aksi halde herkes bu başlığı uydurarak istek sınırını atlatabilirdi."""
    if config.TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else None


class RateLimiter:
    """IP başına kayan pencereli istek sınırı (dakikada N istek). Yalnızca bellekte tutulur, diske yazılmaz."""

    # Dış servislere yük bindiren uçlar daha "pahalı" sayılır.
    COSTS = {"/api/rota": 3, "/api/konum/ip": 3}

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self._last_sweep = time.monotonic()

    def allow(self, key: str, cost: int = 1) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) + cost > self.per_minute:
            return False
        q.extend([now] * cost)
        if now - self._last_sweep > 300:  # boşalmış kayıtları temizle
            self._last_sweep = now
            for k in [k for k, v in self.hits.items() if not v or now - v[-1] > 60]:
                del self.hits[k]
        return True


limiter = RateLimiter(config.RATE_LIMIT_PER_MIN)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
    "X-Frame-Options": "DENY",
}


async def middleware(request: Request, call_next):
    path = request.url.path
    started = time.perf_counter()
    if path.startswith("/api/") and config.RATE_LIMIT_PER_MIN > 0:
        if not limiter.allow(client_ip(request) or "?", RateLimiter.COSTS.get(path, 1)):
            return JSONResponse({"detail": {"hata": "Çok fazla istek. Lütfen biraz sonra tekrar deneyin."}}, status_code=429)
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if not path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    # Erişim günlüğü: sorgu dizesi (konum koordinatları) ve IP adresi YAZILMAZ.
    if path.startswith("/api/"):
        log.info("%s %s %s %.0fms", request.method, path, response.status_code, (time.perf_counter() - started) * 1000)
    return response
