"""Katman verileri için önbellek.

- Veriler bellekte ve .cache/ klasöründe tutulur; sunucu yeniden başlasa da son veri kaybolmaz.
- Arka plan görevi, süresi (ttl) dolan katmanları kendiliğinden yeniler. Böylece yavaş servisler
  (otopark ~25 sn) kullanıcıyı bekletmez.
- Servis hata verirse son başarılı veri "eski" işaretiyle sunulmaya devam eder.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .layers import Layer
from .sources import SourceError

log = logging.getLogger("kent.store")

RETRY_AFTER = 120  # başarısız bir denemeden sonra en erken tekrar deneme (sn)
WAIT_FOR_REFRESH = 3  # eski veri varken yenilemeyi en fazla bu kadar bekle, sonra eskiyi sun
# Kayıt biçimi (sources/parking çıktısı) değişince artırın: eski disk önbelleği yok sayılır.
CACHE_VERSION = 6  # 6: taksi duraklarına telefon (phone, phoneSource) eklendi


@dataclass
class Entry:
    items: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: float = 0.0
    error: str | None = None
    last_attempt: float = 0.0

    @property
    def has_data(self) -> bool:
        return self.fetched_at > 0


class LayerUnavailable(Exception):
    pass


class Store:
    def __init__(self, layers: list[Layer], client: httpx.AsyncClient, cache_dir: Path):
        self.layers = {layer.id: layer for layer in layers}
        self.client = client
        self.dir = cache_dir
        self.dir.mkdir(exist_ok=True)
        self.entries = {lid: self._read(lid) for lid in self.layers}
        self.locks = {lid: asyncio.Lock() for lid in self.layers}
        self._tasks: set[asyncio.Task] = set()

    # ----- disk -----

    def _path(self, lid: str) -> Path:
        return self.dir / f"{lid}.json"

    def _read(self, lid: str) -> Entry:
        try:
            d = json.loads(self._path(lid).read_text(encoding="utf-8"))
            if d.get("version") != CACHE_VERSION:
                return Entry()
            return Entry(items=d["items"], fetched_at=d["fetched_at"])
        except (OSError, ValueError, KeyError):
            return Entry()

    def _write(self, lid: str, e: Entry) -> None:
        try:
            self._path(lid).write_text(json.dumps({"version": CACHE_VERSION, "items": e.items, "fetched_at": e.fetched_at}, ensure_ascii=False), encoding="utf-8")
        except OSError as ex:
            log.warning("%s önbelleğe yazılamadı: %s", lid, ex)

    # ----- yenileme -----

    def is_fresh(self, lid: str) -> bool:
        e = self.entries[lid]
        return e.has_data and time.time() - e.fetched_at < self.layers[lid].ttl

    def _recently_failed(self, lid: str) -> bool:
        e = self.entries[lid]
        return bool(e.error) and time.time() - e.last_attempt < RETRY_AFTER

    async def refresh(self, lid: str, force: bool = False) -> Entry:
        async with self.locks[lid]:
            if not force and self.is_fresh(lid):
                return self.entries[lid]  # bu arada başka bir istek yeniledi
            e = self.entries[lid]
            e.last_attempt = time.time()
            try:
                items = await self.layers[lid].load(self.client)
            except SourceError as ex:
                e.error = str(ex)
                log.warning("%s yenilenemedi: %s", lid, ex)
                return e
            except Exception as ex:  # veri biçimi değişirse sunucu çökmesin
                e.error = "beklenmeyen veri biçimi"
                log.exception("%s işlenemedi: %s", lid, ex)
                return e
            e = self.entries[lid] = Entry(items=items, fetched_at=time.time())
            self._write(lid, e)
            log.info("%s yenilendi (%d kayıt)", lid, len(items))
            return e

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def get(self, lid: str, force: bool = False) -> Entry:
        e = self.entries[lid]
        if force:
            await self.refresh(lid, force=True)
        elif not self.is_fresh(lid) and not self._recently_failed(lid):
            if e.has_data:
                # Eski veri var: kısa süre yenilemeyi bekle, yetişmezse eskiyi sun (yenileme arkada sürer).
                task = self._spawn(self.refresh(lid))
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=WAIT_FOR_REFRESH)
                except TimeoutError:
                    pass
            else:
                await self.refresh(lid)
        e = self.entries[lid]
        if not e.has_data:
            raise LayerUnavailable(e.error or "veri yok")
        return e

    async def shutdown(self) -> None:
        """Sürmekte olan yenilemeleri iptal eder (HTTP istemcisi kapanmadan önce çağrılmalı)."""
        tasks = list(self._tasks)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def run_background(self) -> None:
        while True:
            for lid in self.layers:
                if self.locks[lid].locked() or self.is_fresh(lid) or self._recently_failed(lid):
                    continue
                self._spawn(self.refresh(lid))
            await asyncio.sleep(30)

    def health(self) -> list[dict]:
        now = time.time()
        return [
            {
                "id": lid,
                "baslik": layer.title,
                "kayit": len(self.entries[lid].items),
                "yas_sn": round(now - self.entries[lid].fetched_at) if self.entries[lid].has_data else None,
                "taze": self.is_fresh(lid),
                "hata": self.entries[lid].error,
            }
            for lid, layer in self.layers.items()
        ]
