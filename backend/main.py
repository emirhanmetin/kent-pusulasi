"""Kent Pusulası İzmir - API ve web sunucusu.

Çalıştırma:  python serve.py   (ya da: uvicorn backend.main:app --port 8000)
API belgesi: http://localhost:8000/docs (yalnızca geliştirmede; bkz. config.py)
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles

from . import config, notifications, quakes, security
from .areas import AreaIndex, place_outages
from .geo import DEFAULT_LAT, DEFAULT_LNG, fmt_dist, fmt_duration, haversine, in_izmir, ip_location, nearest_area, with_distance
from .layers import LAYER_BY_ID, LAYERS, MODES, present
from .overview import CARD_BY_ID, CARDS, OUTAGE_CARDS
from .routing import CANDIDATES, Distance, RoutingError, rank, route
from .store import LayerUnavailable, Store
from .text import time_ago, tr_lower

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx her dış isteğin tam adresini yazar; rota isteklerinin adresinde kullanıcı koordinatları bulunur.
logging.getLogger("httpx").setLevel(logging.WARNING)
# Windows kayıt defteri .js için bazen text/plain veriyor; o zaman tarayıcı ES modüllerini yüklemez.
mimetypes.add_type("text/javascript", ".js")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(headers={"User-Agent": "KentPusulasi/0.3 (acik veri prototipi)"}, follow_redirects=True) as client:
        app.state.client = client
        app.state.store = Store(LAYERS, client, ROOT / ".cache")
        app.state.subs = notifications.Subscriptions(ROOT / ".cache" / "bildirim.db")
        tasks = [
            asyncio.create_task(app.state.store.run_background()),
            asyncio.create_task(notifications.run(app.state.store, client, app.state.subs, lambda: _area_index_of(app.state.store))),
        ]
        try:
            yield
        finally:
            # Önce arka plan işlerini durdur, sonra HTTP istemcisi kapansın.
            for t in tasks:
                t.cancel()
            await app.state.store.shutdown()


app = FastAPI(
    title="Kent Pusulası İzmir API",
    version="1.0",
    lifespan=lifespan,
    docs_url="/docs" if config.DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if config.DOCS else None,
)
app.middleware("http")(security.middleware)

Lat = Query(DEFAULT_LAT, ge=-90, le=90, description="Enlem")
Lng = Query(DEFAULT_LNG, ge=-180, le=180, description="Boylam")


def _layer_or_404(layer_id: str):
    layer = LAYER_BY_ID.get(layer_id)
    if not layer or not layer.available():
        raise HTTPException(404, detail={"hata": "böyle bir menü yok"})
    return layer


async def _entry(request: Request, layer_id: str, force: bool = False):
    try:
        return await request.app.state.store.get(layer_id, force=force)
    except LayerUnavailable as e:
        raise HTTPException(503, detail={"hata": str(e)}) from e


# ---------- Menüler ----------


@app.get("/api/katmanlar", summary="Menü listesi")
async def katmanlar():
    return [layer.meta() for layer in LAYERS if layer.listed and layer.available()]


@app.get("/api/katman/{layer_id}", summary="Bir menünün kayıtları, konuma göre sıralı")
async def katman(
    request: Request,
    layer_id: str,
    lat: float = Lat,
    lng: float = Lng,
    filtre: str | None = None,
    q: str = "",
    yenile: bool = False,
    mod: str | None = Query(None, description="arac | yuruyus (verilmezse menünün varsayılanı)"),
):
    layer = _layer_or_404(layer_id)
    profile = MODES.get(mod or "", layer.default_mode)
    e = await _entry(request, layer_id, force=yenile)

    filters = layer.filters()
    cur = next((f for f in filters if f.id == filtre), filters[0] if filters else None)
    items = place_outages(e.items, await _area_index(request), lat, lng) if layer.outage else e.items
    pairs = with_distance(items, lat, lng)
    if not layer.sort_by_distance:
        order = {id(it): i for i, it in enumerate(items)}
        pairs.sort(key=lambda p: order[id(p[0])])
    if cur and cur.fn:
        pairs = [p for p in pairs if cur.fn(p[0])]
    if q.strip():
        needle = tr_lower(q.strip())
        pairs = [p for p in pairs if needle in tr_lower(" ".join(str(p[0].get(k) or "") for k in ("name", "ilce", "mahalle", "address", "streetText")))]

    if layer.routing:
        ranked, route_error = await rank(request.app.state.client, pairs, (lat, lng), profile=profile)
    else:
        ranked, route_error = [(it, Distance(air=d) if d is not None else None) for it, d in pairs], None
    road_count = sum(1 for _, d in ranked if d is not None and d.road is not None)

    return {
        "mesafe": {
            "tur": "yol" if road_count else "kus",
            "yolSayisi": road_count,
            "adaySayisi": CANDIDATES,
            "hata": route_error,
            "mod": {v: k for k, v in MODES.items()}[profile],
        },
        "durum": {
            "guncellendi": e.fetched_at,
            "guncellendiMetin": time_ago(e.fetched_at),
            "eski": bool(e.error),
            "hata": e.error,
            "damga": layer.stamp(e.items),
        },
        "filtreler": [{"id": f.id, "label": f.label} for f in filters],
        "filtre": cur.id if cur else None,
        "toplam": len(e.items),
        "items": [present(layer, it, d) for it, d in ranked],
    }


# ---------- Yakınımda ----------


@app.get("/api/yakinimda", summary="Yakınımda ekranındaki kartlar")
async def yakinimda_kartlar():
    return (
        [{"id": "deprem", "layer": "deprem", "label": "Son deprem (İzmir ve çevresi)"}]
        + [{"id": c.id, "layer": c.layer, "label": c.label()} for c in CARDS]
        + [c for c in OUTAGE_CARDS if LAYER_BY_ID[c["layer"]].available()]
    )


@app.get("/api/yakinimda/{card_id}", summary="Tek bir kartın içeriği")
async def yakinimda_kart(request: Request, card_id: str, lat: float = Lat, lng: float = Lng):
    if any(c["id"] == card_id for c in OUTAGE_CARDS):
        return await _outage_card(request, card_id, lat, lng)
    if card_id == "deprem":
        return await _quake_card(request, lat, lng)
    card = CARD_BY_ID.get(card_id)
    if not card:
        raise HTTPException(404, detail={"hata": "böyle bir kart yok"})
    layer = LAYER_BY_ID[card.layer]
    e = await _entry(request, card.layer)
    pairs = with_distance(e.items, lat, lng)
    candidates = [p for p in pairs if p[1] is not None and card.pred(p[0])]
    if not candidates and card.fallback_any:
        candidates = [p for p in pairs if p[1] is not None]
    if not candidates:
        return {"main": card.none, "sub": "", "cls": "muted", "item": None}
    if layer.routing:
        ranked, _ = await rank(request.app.state.client, candidates, (lat, lng), profile=layer.default_mode, candidates=10)
    else:
        ranked = [(it, Distance(air=d)) for it, d in candidates]
    it, d = ranked[0]
    return {
        "main": card.main(it, d),
        "sub": card.sub(it, d) + (" · eski veri" if e.error else ""),
        "cls": "",
        "item": present(layer, it, d),
    }


async def _quake_card(request: Request, lat: float, lng: float):
    """Son 24 saatteki en yeni M2.5+ deprem (yoksa son 24 saatin en büyüğü)."""
    e = await _entry(request, "deprem")
    recent = [it for it in e.items if quakes.age_hours(it) <= 24]
    felt = [it for it in recent if (it["magnitude"] or 0) >= 2.5]
    if not recent:
        return {"main": "Son 24 saatte kayda değer deprem yok", "sub": "Kaynak: AFAD", "cls": "muted", "item": None}
    it = felt[0] if felt else max(recent, key=lambda x: x["magnitude"] or 0)
    d = haversine(lat, lng, it["lat"], it["lng"])
    layer = LAYER_BY_ID["deprem"]
    return {
        "main": it["name"],
        "sub": f"{quakes.when_text(it)} · {fmt_dist(d)} uzağınızda · son 24 saatte {len(recent)} deprem",
        "cls": "warn" if (it["magnitude"] or 0) >= 4 else "",
        "item": present(layer, it, Distance(air=d)),
    }


async def _outage_card(request: Request, layer_id: str, lat: float, lng: float):
    """Tahmini ilçedeki su / elektrik kesintisi sayısı."""
    try:
        e = await request.app.state.store.get(layer_id)
    except LayerUnavailable as ex:
        missing_account = "hesabı tanımlı değil" in str(ex)
        return {
            "main": "EPİAŞ hesabı gerekli" if missing_account else "Servis şu anda yanıt vermiyor",
            "sub": "Ayrıntı için menüyü açın" if missing_account else str(ex),
            "cls": "muted" if missing_account else "err",
            "item": None,
        }
    area = await _area(request, lat, lng)
    ilce = area["ilce"] if area else None
    mine = [it for it in e.items if tr_lower(it.get("ilce")) == tr_lower(ilce)] if ilce else e.items
    where = f"{ilce} ilçesinde" if ilce else "İzmir genelinde"
    planned = sum(1 for it in mine if it.get("kind") == "Planlı")
    detail = f" ({planned} planlı)" if planned else ""
    return {
        "main": f"{where} {len(mine)} kesinti{detail}" if mine else f"{where} duyurulmuş kesinti yok",
        "sub": f"İzmir genelinde {len(e.items)} kayıt",
        "cls": "warn" if mine else "",
        "item": None,
    }


# ---------- Mahalle konumları (kesintiler için) ----------

_area_cache: dict[str, Any] = {"key": None, "index": None}


async def _area_index(request: Request) -> AreaIndex:
    return await _area_index_of(request.app.state.store)


async def _area_index_of(store) -> AreaIndex:
    """Konumlu belediye verilerinden mahalle merkezleri; kaynak veriler yenilenince yeniden kurulur."""
    sets, key = [], []
    for lid in ("toplanma", "pazar", "taksi", "wifi"):
        try:
            e = await store.get(lid)
        except LayerUnavailable:
            continue
        sets.append(e.items)
        key.append((lid, e.fetched_at))
    if _area_cache["key"] != tuple(key):
        _area_cache.update(key=tuple(key), index=AreaIndex(sets))
    return _area_cache["index"]


# ---------- Rota ----------


@app.get("/api/rota", summary="Konumdan hedefe rota (haritada çizmek için)")
async def rota(
    request: Request,
    lat: float = Lat,
    lng: float = Lng,
    hlat: float = Query(..., ge=-90, le=90, description="Hedef enlem"),
    hlng: float = Query(..., ge=-180, le=180, description="Hedef boylam"),
    mod: str = Query("arac", description="arac | yuruyus"),
):
    try:
        r = await route(request.app.state.client, (lat, lng), (hlat, hlng), profile=MODES.get(mod, "driving"))
    except RoutingError as e:
        raise HTTPException(503, detail={"hata": f"rota alınamadı ({e})"}) from e
    return {**r, "mesafeMetin": fmt_dist(r["mesafe"]), "sureMetin": fmt_duration(r["sure"])}


# ---------- Konum servisi ----------


async def _area(request: Request, lat: float, lng: float) -> dict | None:
    try:
        points = (await request.app.state.store.get("toplanma")).items
    except LayerUnavailable:
        return None
    return nearest_area(points, lat, lng)


@app.get("/api/konum/bolge", summary="Koordinattan tahmini mahalle ve ilçe")
async def konum_bolge(request: Request, lat: float = Lat, lng: float = Lng):
    if not in_izmir(lat, lng):
        return {"mahalle": None, "ilce": None, "izmirde": False}
    area = await _area(request, lat, lng)
    return {**(area or {"mahalle": None, "ilce": None}), "izmirde": True}


@app.get("/api/konum/ip", summary="IP adresine göre yaklaşık konum (tarayıcı konumu alınamazsa)")
async def konum_ip(request: Request):
    # IP adresini üçüncü taraf bir servise gönderdiği için varsayılan olarak kapalı (KP_IP_KONUM=1 ile açılır).
    if not config.IP_LOCATION:
        raise HTTPException(404, detail={"hata": "IP konumu bu sunucuda kapalı"})
    ip = security.client_ip(request)
    try:
        return await ip_location(request.app.state.client, ip)
    except LookupError as e:
        raise HTTPException(503, detail={"hata": str(e)}) from e


# ---------- Çevrimdışı paket ----------


@app.get("/api/cevrimdisi", summary="İnternet yokken kullanılmak üzere telefona kaydedilen toplanma alanları")
async def cevrimdisi(request: Request):
    """Kısa biçim: [id, ad, enlem, boylam, mahalle, ilçe]. Uygulama bunu günde bir indirir; deprem sonrası
    internet kesilse bile en yakın toplanma alanını telefonun kendi GPS'iyle bulabilir."""
    e = await _entry(request, "toplanma")
    return {
        "surum": e.fetched_at,
        "toplanma": [
            [it["id"], it["name"], round(it["lat"], 6), round(it["lng"], 6), it.get("mahalle") or "", it.get("ilce") or ""]
            for it in e.items
        ],
    }


# ---------- Anlık bildirim aboneliği ----------


class Abonelik(BaseModel):
    token: str = Field(..., max_length=200, description="Expo bildirim anahtarı (ExponentPushToken[...])")
    ilce: str | None = Field(None, max_length=60)
    mahalle: str | None = Field(None, max_length=80)
    turler: list[str] = Field(default_factory=lambda: list(notifications.TYPES), max_length=len(notifications.TYPES))
    yaricap: float = Field(0, ge=0, le=5, description="Yakındaki mahalleler için km (0 = yalnızca seçilen mahalle)")


def _check_token(token: str) -> str:
    if not notifications.valid_token(token):
        raise HTTPException(400, detail={"hata": "geçersiz bildirim anahtarı"})
    return token


@app.post("/api/bildirim/abone", summary="Anlık bildirim aboneliği ekle / güncelle")
async def abone_ol(request: Request, body: Abonelik):
    _check_token(body.token)
    turler = [t for t in body.turler if t in notifications.TYPES]
    if not turler:
        raise HTTPException(400, detail={"hata": "en az bir bildirim türü seçin"})
    if {"su", "elektrik", "hava"} & set(turler) and not (body.ilce or "").strip():
        raise HTTPException(400, detail={"hata": "kesinti ve hava bildirimleri için ilçe gerekli"})
    request.app.state.subs.upsert(
        body.token, (body.ilce or "").strip() or None, (body.mahalle or "").strip() or None, turler, body.yaricap
    )
    return {"tamam": True, **request.app.state.subs.get(body.token)}


@app.get("/api/bildirim/abone", summary="Aboneliği görüntüle")
async def abonelik(request: Request, token: str = Query(..., max_length=200)):
    sub = request.app.state.subs.get(_check_token(token))
    if not sub:
        raise HTTPException(404, detail={"hata": "abonelik yok"})
    return sub


@app.delete("/api/bildirim/abone", summary="Aboneliği ve gönderim kayıtlarını sil")
async def abonelikten_cik(request: Request, token: str = Query(..., max_length=200)):
    request.app.state.subs.delete(_check_token(token))
    return {"tamam": True}


# ---------- Sağlık ----------


@app.get("/api/saglik", summary="Veri servislerinin durumu")
async def saglik(request: Request):
    return {"veriler": request.app.state.store.health(), "bildirimAbonesi": request.app.state.subs.count()}


# Arayüz dosyaları (API yollarından sonra bağlanmalı)
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
