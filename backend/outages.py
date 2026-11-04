"""Su ve elektrik kesintileri.

Su (İZSU):
  1. Açık veri API'si /izsu/arizakaynaklisukesintileri (belgelenmiş alanlar: Tip, Ongoru, Birim, KesintiTarihi,
     ArizaGiderilmeTarihi, IlceAdi, Mahalleler, KesintiSuresi, Aciklama).
  2. API hata verirse İZSU'nun "Arıza ve Bakım Bilgisi" sayfası okunur (robots.txt bu sayfaya izin veriyor;
     /api/ yolları yasak olduğundan onlara istek atılmaz). Sayfa hem arıza hem planlı bakım kayıtlarını içerir.

Elektrik:
  1. Gediz Elektrik'in kendi sitesinin kesinti haritasını besleyen servis (www.gdzelektrik.com.tr/api/...).
     Kimlik istemez; etkilenen mahalleleri, SOKAKLARI ve etkilenen alanın çokgenini verir. Belgelenmiş bir
     açık API değildir, haber verilmeden değişebilir; robots.txt /api/ yollarını yasaklamaz. Arızalar il
     genelinde tek istekte, planlı kesintiler ilçe ilçe alınır. Site art arda gelen isteklere bot koruması
     uyguladığından ilçeler aralıklı sorulur (veri 15 dakikada bir, arka planda yenilenir).
  2. Yedek: EPİAŞ Şeffaflık Platformu (Gediz dahil tüm dağıtım şirketleri). Gediz'e ulaşılamazsa ya da bazı
     ilçeler alınamazsa o kısım EPİAŞ'tan tamamlanır. Kimlik doğrulaması (TGT) ister: ücretsiz bir EPİAŞ
     hesabının bilgileri .env dosyasına EPIAS_USERNAME / EPIAS_PASSWORD olarak yazılır (bkz. .env.example).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any

import httpx

from . import config
from .sources import SourceError, fetch_json, pick
from .text import MONTHS, title_case, tr_upper

log = logging.getLogger("kent.outages")
Item = dict[str, Any]

IZSU_PAGE = "https://www.izsu.gov.tr/bilgi-merkezi/ariza-ve-bakim-bilgisi-sorgulama"
EPIAS_LOGIN = "https://giris.epias.com.tr/cas/v1/tickets"
EPIAS_API = "https://seffaflik.epias.com.tr/electricity-service"
TR_TZ = timezone(timedelta(hours=3))


def _iso(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _fmt_dt(value: str | None) -> str | None:
    """'2026-09-26T14:00:00+03:00' -> '26 Eylül 14:00'"""
    if not value:
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(TR_TZ)
    except ValueError:
        return value
    return f"{d.day} {MONTHS[d.month - 1]} {d:%H:%M}"


def _parse_tr_datetime(text: str | None) -> datetime | None:
    """'25.09.2026 - 08:00' ya da '25.09.2026 08:00' -> datetime (TR saati)"""
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})\D+(\d{1,2}):(\d{2})", text or "")
    if not m:
        return None
    d, mo, y, h, mi = map(int, m.groups())
    return datetime(y, mo, d, h, mi, tzinfo=TR_TZ)


def _neighbourhoods(text: str | None) -> str:
    parts = [title_case(p.strip()) for p in re.split(r"[,;]", text or "") if p.strip()]
    return ", ".join(parts)


# ---------- Su: İZSU ----------


class _TableParser(HTMLParser):
    """Sayfadaki tabloları [başlıklar, satırlar] olarak toplar. Hücrede title="..." varsa (kısaltılmış metnin
    tamamı) onu kullanır."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self._table: dict | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._cell_title: str | None = None
        self._in_th = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self._table = {"heads": [], "rows": []}
        elif self._table is None:
            return
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell, self._cell_title, self._in_th = [], None, tag == "th"
        elif self._cell is not None and a.get("title") and not self._cell_title:
            self._cell_title = a["title"]

    def handle_endtag(self, tag):
        if self._table is None:
            return
        if tag in ("td", "th") and self._cell is not None:
            text = re.sub(r"\s+", " ", self._cell_title or "".join(self._cell)).strip()
            if self._in_th:
                self._table["heads"].append(text)
            elif self._row is not None:
                self._row.append(text)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self._table["rows"].append(self._row)
            self._row = None
        elif tag == "table":
            self.tables.append(self._table)
            self._table = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _su_from_api(data: Any) -> list[Item]:
    arr = data if isinstance(data, list) else (data.get("Data") or data.get("data") or [])
    items = []
    for i, x in enumerate(arr):
        ilce = title_case(pick(x, "IlceAdi", "Ilce"))
        items.append({
            "id": f"su-api-{i}",
            "name": ilce or "Su kesintisi",
            "kind": "Arıza",
            "ilce": ilce,
            "mahalle": _neighbourhoods(pick(x, "Mahalleler", "Mahalle")),
            "reason": pick(x, "Tip"),
            "duration": pick(x, "KesintiSuresi"),
            "description": pick(x, "Aciklama"),
            "start": _fmt_dt(pick(x, "KesintiTarihi")),
            "end": _fmt_dt(pick(x, "ArizaGiderilmeTarihi")) if str(pick(x, "Ongoru")) != "1" else "Belirsiz",
            "lat": None,
            "lng": None,
        })
    return items


def _su_from_page(html: str) -> tuple[list[Item], str | None]:
    p = _TableParser()
    p.feed(html)
    items: list[Item] = []
    for t in p.tables:
        heads = t["heads"]
        idx = {h: i for i, h in enumerate(heads)}
        cell = lambda row, name: row[idx[name]] if name in idx and idx[name] < len(row) else None  # noqa: E731
        if "Arıza Tipi" in idx:
            for r in t["rows"]:
                ilce = title_case(cell(r, "İlçe"))
                items.append({
                    "id": f"su-ariza-{len(items)}",
                    "name": ilce or "Su kesintisi",
                    "kind": "Arıza",
                    "ilce": ilce,
                    "mahalle": _neighbourhoods(cell(r, "Mahalleler")),
                    "reason": cell(r, "Arıza Tipi"),
                    "duration": cell(r, "Kesinti Süresi"),
                    "description": cell(r, "Açıklama"),
                    "lat": None,
                    "lng": None,
                })
        elif "İş Adı" in idx:
            for r in t["rows"]:
                ilce = title_case(cell(r, "İlçe"))
                start, end = cell(r, "Kesinti Başlangıç"), cell(r, "Kesinti Bitiş")
                items.append({
                    "id": f"su-planli-{len(items)}",
                    "name": ilce or "Planlı bakım",
                    "kind": "Planlı",
                    "ilce": ilce,
                    "mahalle": _neighbourhoods(cell(r, "Mahalleler")),
                    "reason": cell(r, "İş Adı"),
                    "duration": f"{start} – {end}" if start and end else start,
                    "start": start,
                    "end": end,
                    "description": cell(r, "Kısa Açıklama"),
                    "lat": None,
                    "lng": None,
                })
    # Sayfa tabloları sayfalı; ilk sayfada gösterilenden fazla kayıt varsa not düş.
    totals = [int(n) for n in re.findall(r"(\d+)\s*kayıttan", html)]
    note = None
    if totals and sum(totals) > len(items):
        note = f"İZSU sayfasında {sum(totals)} kayıt var, ilk {len(items)} tanesi gösteriliyor."
    return items, note


async def su_kesintileri(client: httpx.AsyncClient) -> list[Item]:
    try:
        return _su_from_api(await fetch_json(client, "/izsu/arizakaynaklisukesintileri"))
    except SourceError as e:
        log.info("İZSU API'si çalışmıyor (%s), İZSU sayfası okunuyor", e)
    try:
        r = await client.get(IZSU_PAGE, timeout=30)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise SourceError(f"İZSU sayfasına ulaşılamadı ({e})") from e
    items, note = _su_from_page(r.text)
    if note:
        log.warning(note)
    # Sayfada süresi geçmiş planlı bakımlar da kalabiliyor; bitmiş olanları gösterme.
    now = datetime.now(TR_TZ)
    return [it for it in items if not ((end := _parse_tr_datetime(it.get("end"))) and end < now)]


# ---------- Elektrik: Gediz Elektrik ----------

GDZ_API = "https://www.gdzelektrik.com.tr/api"
GDZ_UNPLANNED = f"{GDZ_API}/outages-v2-unplanned"  # arızalar, il genelinde tek istek
GDZ_PLANNED = f"{GDZ_API}/test-outages"  # planlı kesintiler, ilçe başına (sitenin kendi kullandığı ad)
# Gediz'in sitesindeki ilçe adları (assets/js/data/gdz_districts.json, il kodu 35)
GDZ_DISTRICTS = [
    "Aliağa", "Bayındır", "Bergama", "Bornova", "Çeşme", "Dikili", "Foça", "Karaburun", "Karşıyaka", "Kemalpaşa",
    "Kınık", "Kiraz", "Menemen", "Ödemiş", "Seferihisar", "Selçuk", "Tire", "Torbalı", "Urla", "Beydağ", "Buca",
    "Konak", "Menderes", "Balçova", "Çiğli", "Gaziemir", "Narlıdere", "Güzelbahçe", "Bayraklı", "Karabağlar",
]
GDZ_GAP = 1.5  # sn: ilçe istekleri arası bekleme (art arda istekler bot korumasına takılıyor)
GDZ_DONE = {"Arşivlendi", "Planlı Kesinti İptal Edildi", "Tamamlandı", "İptal Edildi"}
GDZ_DAYS_AHEAD = 3  # planlı kesintilerden bugün ve önümüzdeki 2 gün gösterilir


class GdzError(SourceError):
    pass


async def _gdz_get(client: httpx.AsyncClient, url: str, **params: str) -> list[dict]:
    try:
        r = await client.get(url, params={"city": "izmir", "action": "outages", **params}, headers={"Accept": "application/json"}, timeout=30)
        r.raise_for_status()
        data = r.json()  # bot koruması devreye girerse HTML döner -> ValueError
    except (httpx.HTTPError, ValueError) as e:
        raise GdzError(f"Gediz servisi yanıt vermedi ({type(e).__name__})") from e
    if not isinstance(data, dict) or data.get("success") is not True:
        raise GdzError("Gediz servisi beklenmeyen yanıt döndürdü")
    return data.get("data") or []


def _gdz_time(value: str | None) -> datetime | None:
    """'2026-10-07 10:00:00.362' (TR saati) -> datetime"""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.strip().replace(" ", "T")).replace(tzinfo=TR_TZ)
    except ValueError:
        return None


def _gdz_shape(geo: Any) -> dict | None:
    """Gediz'in alan çokgeni: etkilenen sokakları kapsayan halka ([boylam, enlem] köşeleri) ve merkezi."""
    if not isinstance(geo, dict):
        return None
    ring = [[float(p[0]), float(p[1])] for p in geo.get("halka") or [] if isinstance(p, list) and len(p) >= 2]
    centre = geo.get("merkez")
    if len(ring) < 3 or not (isinstance(centre, list) and len(centre) >= 2):
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {"ring": ring, "center": [float(centre[0]), float(centre[1])]}


def _gdz_item(x: dict, kind: str) -> Item | None:
    if x.get("Durum") in GDZ_DONE:
        return None
    start = _gdz_time(x.get("Kesinti_Baslangic_Zamani")) or _gdz_time(x.get("Planlanan_Baslangic_Zamani"))
    end = _gdz_time(x.get("Kesinti_Sona_Erme_Zamani")) or _gdz_time(x.get("Planlanan_Sona_Erme_Zamani"))
    now = datetime.now(TR_TZ)
    if end and end < now:
        return None  # bitmiş
    if start and start > now.replace(hour=0, minute=0) + timedelta(days=GDZ_DAYS_AHEAD):
        return None  # çok ileri tarihli
    mahalleler = [title_case(m) for m in x.get("Mahalle") or [] if m]
    streets = {title_case(s.get("Mahalle")): [str(k) for k in s.get("Sokak") or []] for s in x.get("MahalleSokak") or [] if s.get("Mahalle")}
    ilce = title_case(x.get("Ilce"))
    fmt = lambda d: f"{d.day} {MONTHS[d.month - 1]} {d:%H:%M}" if d else None  # noqa: E731
    return {
        "id": f"elektrik-gdz-{x.get('Kesinti_ID')}",
        "name": ilce or "Elektrik kesintisi",
        "kind": kind,
        "status": x.get("Durum"),
        "ilce": ilce,
        "mahalle": ", ".join(mahalleler),
        "streets": streets,
        "streetText": " ".join(s for ss in streets.values() for s in ss),  # sokak adıyla arama için
        "shape": _gdz_shape(x.get("Alan_Geometri")),
        "reason": x.get("Kesinti_Nedeni") or ("Arıza" if kind == "Arıza" else None),
        "duration": f"{fmt(start)} – {fmt(end)}" if start and end else (f"{fmt(start)} başladı, bitiş belirsiz" if start else None),
        "start": fmt(start),
        "end": fmt(end) or ("Belirsiz" if kind == "Arıza" else None),
        "startIso": start.isoformat() if start else None,
        "company": "Gediz Elektrik",
        "lat": None,
        "lng": None,
    }


async def _gdz_kesintileri(client: httpx.AsyncClient) -> tuple[list[Item], list[str]]:
    """Gediz'den arıza + planlı kesintiler. İkinci değer: verisi alınamayan ilçeler (EPİAŞ'tan tamamlanır)."""
    items: list[Item] = []
    failed: list[str] = []
    try:
        items += [it for x in await _gdz_get(client, GDZ_UNPLANNED) if (it := _gdz_item(x, "Arıza"))]
    except GdzError as e:
        log.warning("Gediz arıza listesi alınamadı: %s", e)
        failed.append("*arıza*")
    for i, district in enumerate(GDZ_DISTRICTS):
        if i:
            await asyncio.sleep(GDZ_GAP)
        try:
            rows = await _gdz_get(client, GDZ_PLANNED, district=district)
        except GdzError:
            try:  # bot koruması kısa sürer; bir kez daha dene
                await asyncio.sleep(GDZ_GAP * 4)
                rows = await _gdz_get(client, GDZ_PLANNED, district=district)
            except GdzError as e:
                log.warning("Gediz planlı kesintiler alınamadı (%s): %s", district, e)
                failed.append(district)
                continue
        items += [it for x in rows if (it := _gdz_item(x, "Planlı"))]
    if len(failed) > len(GDZ_DISTRICTS) // 2:
        raise GdzError(f"Gediz servisinden {len(failed)} sorgu alınamadı")
    return items, failed


# ---------- Elektrik: EPİAŞ ----------


_tgt: tuple[float, str] | None = None
_province_id: int | None = None
TGT_TTL = 90 * 60  # EPİAŞ TGT'si yaklaşık 2 saat geçerli; erken yenile


# Reddedilen bilgilerle tekrar tekrar giriş denemek hesabı kilitletebilir. Giriş reddedilince bu bilgilerin
# parmak izi saklanır ve .env değişene (ya da süre dolana) kadar EPİAŞ'a yeniden giriş isteği atılmaz.
_rejected: tuple[float, int] | None = None
REJECT_COOLDOWN = 6 * 3600


def _credentials() -> tuple[str, str] | None:
    config.load_dotenv(override=True)  # .env sonradan düzenlenirse yeniden başlatmadan al
    user, password = os.environ.get("EPIAS_USERNAME"), os.environ.get("EPIAS_PASSWORD")
    return (user, password) if user and password else None


def has_credentials() -> bool:
    """EPİAŞ yedeği yalnızca hesap tanımlıysa kullanılır."""
    return _credentials() is not None


async def _epias_tgt(client: httpx.AsyncClient) -> str:
    global _tgt, _rejected
    if _tgt and time.time() - _tgt[0] < TGT_TTL:
        return _tgt[1]
    creds = _credentials()
    if not creds:
        raise SourceError("EPİAŞ hesabı tanımlı değil")
    user, password = creds
    fingerprint = hash(creds)
    if _rejected and _rejected[1] == fingerprint and time.time() - _rejected[0] < REJECT_COOLDOWN:
        raise SourceError("EPİAŞ girişi reddedildi; .env'deki bilgiler düzeltilince yeniden denenecek")
    try:
        r = await client.post(
            EPIAS_LOGIN,
            data={"username": user, "password": password},
            headers={"Accept": "text/plain"},
            timeout=20,
        )
    except httpx.HTTPError as e:
        raise SourceError(f"EPİAŞ girişine ulaşılamadı ({type(e).__name__})") from e
    if r.status_code in (400, 401, 403):
        _rejected = (time.time(), fingerprint)
        log.warning("EPİAŞ girişi reddedildi (HTTP %s); .env düzeltilene kadar yeniden denenmeyecek", r.status_code)
        raise SourceError(f"EPİAŞ girişi reddedildi (HTTP {r.status_code}); kullanıcı adı/şifreyi ve hesabın etkinleştirildiğini kontrol edin")
    if r.status_code not in (200, 201) or not r.text.startswith("TGT-"):
        raise SourceError(f"EPİAŞ girişi başarısız (HTTP {r.status_code})")
    _rejected = None
    _tgt = (time.time(), r.text.strip())
    return _tgt[1]


async def _epias(client: httpx.AsyncClient, method: str, path: str, body: dict | None = None) -> Any:
    global _tgt
    for attempt in range(2):
        tgt = await _epias_tgt(client)
        try:
            r = await client.request(method, f"{EPIAS_API}{path}", json=body, headers={"TGT": tgt, "Accept": "application/json"}, timeout=30)
        except httpx.HTTPError as e:
            raise SourceError(f"EPİAŞ'a ulaşılamadı ({e})") from e
        if r.status_code == 401 and attempt == 0:
            _tgt = None  # süresi dolmuş olabilir, bir kez yenile
            continue
        if r.status_code != 200:
            raise SourceError(f"EPİAŞ HTTP {r.status_code}")
        return r.json()
    raise SourceError("EPİAŞ kimlik doğrulaması başarısız")


async def _izmir_province_id(client: httpx.AsyncClient) -> int | None:
    global _province_id
    if _province_id is None:
        data = await _epias(client, "GET", "/v1/main/province-list")
        rows = data if isinstance(data, list) else data.get("items", [])
        for p in rows:
            name = tr_upper(str(p.get("name") or p.get("provinceName") or ""))
            if "İZMİR" in name:
                _province_id = int(p.get("id") or p.get("provinceId"))
                break
    return _province_id


async def _epias_outages(client: httpx.AsyncClient, path: str, kind: str, day: datetime, province_id: int | None) -> list[Item]:
    items: list[Item] = []
    page = 1
    while page <= 10:
        body: dict[str, Any] = {"period": day.isoformat(), "page": {"number": page, "size": 100}}
        if province_id:
            body["provinceId"] = province_id
        data = await _epias(client, "POST", path, body)
        rows = data.get("items") or []
        now = datetime.now(TR_TZ)
        for x in rows:
            if province_id is None and "İZMİR" not in tr_upper(str(x.get("province") or "")):
                continue
            if (end_dt := _iso(x.get("endTime"))) and end_dt < now:
                continue  # bitmiş kesinti
            ilce = title_case(x.get("district"))
            start, end = _fmt_dt(x.get("startTime")), _fmt_dt(x.get("endTime"))
            items.append({
                "id": f"elektrik-{kind}-{x.get('id') or len(items)}",
                "name": ilce or "Elektrik kesintisi",
                "kind": kind,
                "ilce": ilce,
                "mahalle": _neighbourhoods(x.get("effectedNeighbourhoods")),
                "reason": x.get("reason"),
                "duration": f"{start} – {end}" if start and end else start,
                "start": start,
                "end": end,
                "startIso": x.get("startTime"),
                "subscribers": x.get("effectedSubscribers"),
                "company": x.get("distributionCompanyName"),
                "lat": None,
                "lng": None,
            })
        total = ((data.get("page") or {}).get("total")) or 0
        if not rows or page * 100 >= total:
            break
        page += 1
    return items


def _unique_sorted(items: list[Item]) -> list[Item]:
    """Aynı kayıt iki sorguda dönebilir; önce arızalar, sonra planlılar, her grup başlangıç saatine göre."""
    seen, unique = set(), []
    for it in items:
        if it["id"] not in seen:
            seen.add(it["id"])
            unique.append(it)
    unique.sort(key=lambda it: (it["kind"] != "Arıza", it.get("startIso") or ""))
    return unique


async def elektrik_kesintileri(client: httpx.AsyncClient) -> list[Item]:
    """Önce Gediz (sokak ve alan bilgisiyle); Gediz'den alınamayan kısım EPİAŞ'tan tamamlanır."""
    try:
        items, failed = await _gdz_kesintileri(client)
    except GdzError as e:
        if not has_credentials():
            raise SourceError(f"{e}; yedek EPİAŞ hesabı da tanımlı değil") from e
        log.warning("Gediz verisi alınamadı (%s), EPİAŞ kullanılıyor", e)
        return await _epias_kesintileri(client)
    if failed and has_credentials():
        try:
            backup = await _epias_kesintileri(client)
        except SourceError as e:
            log.warning("Eksik ilçeler EPİAŞ'tan da alınamadı: %s", e)
        else:
            need_faults = "*arıza*" in failed
            districts = {tr_upper(d) for d in failed if d != "*arıza*"}
            items += [
                it for it in backup
                if (it["kind"] == "Arıza" and need_faults) or (it["kind"] == "Planlı" and tr_upper(it.get("ilce") or "") in districts)
            ]
    return _unique_sorted(items)


async def _epias_kesintileri(client: httpx.AsyncClient) -> list[Item]:
    province = await _izmir_province_id(client)
    today = datetime.now(TR_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    items = await _epias_outages(client, "/v1/consumption/data/unplanned-power-outage-info", "Arıza", today, province)
    for d in (today, today + timedelta(days=1)):
        items += await _epias_outages(client, "/v1/consumption/data/planned-power-outage-info", "Planlı", d, province)
    return _unique_sorted(items)
