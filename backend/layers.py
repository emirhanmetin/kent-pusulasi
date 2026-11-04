"""Menüler ("katmanlar"): her birinin veri kaynağı, filtreleri ve nasıl gösterileceği.

Yeni menü eklemek için LAYERS listesine bir Layer ekleyin. CBS "önemli yer" servisleri
(müze, plaj, muhtarlık...) genelde tek satırla eklenir: load=lambda c: sources.cbs(c, "servisadi")
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx

from . import city, outages, parking, preparedness, quakes, sources, taxi
from .geo import fmt_dist, fmt_duration
from .routing import Distance
from .text import DAY_NAMES, DAY_SHORT, fmt_date, fmt_datetime, fmt_phone, today_weekday

Item = dict[str, Any]
MIN, HOUR, DAY = 60, 3600, 86400


@dataclass
class Filter:
    id: str
    label: str
    fn: Callable[[Item], bool] | None = None


@dataclass
class Layer:
    id: str
    group: str
    title: str
    icon: list[str]  # Lucide ikon adları (ilk bulunan kullanılır)
    color: str
    ttl: int  # saniye; bu süreden eski veri arka planda yenilenir
    intro: str
    load: Callable[[httpx.AsyncClient], Awaitable[list[Item]]]
    nav_title: str | None = None
    cluster: bool = False
    slow: bool = False
    no_map: bool = False
    outage: bool = False  # kesinti listesi: mahalle bazlı, haritada renkli alanlarla gösterilir
    search: bool = True
    search_placeholder: str = "Ad, mahalle veya ilçe ara"
    empty_text: str = "Kayıt bulunamadı."
    error_text: str = "Belediyenin veri servisi şu anda yanıt vermiyor. Biraz sonra tekrar deneyin."
    error_link: dict | None = None
    directions: str = "driving"  # Google Haritalar yol tarifi modu
    routing: bool = True  # False: yol mesafesi hesaplanmaz, kuş uçuşu yeterli (ör. hava istasyonu)
    default_mode: str = "driving"  # driving | walking (ör. toplanma alanlarına yürünür)
    filters: Callable[[], list[Filter]] = field(default=lambda: [])
    badge: Callable[[Item], str | None] = field(default=lambda it: None)
    marker_color: Callable[[Item], str] | None = None
    details: Callable[[Item], list[tuple[str, Any]]] = field(default=lambda it: [])
    stamp: Callable[[list[Item]], str | None] = field(default=lambda items: None)
    # False dönerse menü hiç gösterilmez (ör. gerekli bir hesap tanımlı değilse)
    available: Callable[[], bool] = field(default=lambda: True)
    # False: menülerde gösterilmez ama /api/katman/{id} çalışır (ör. bildirim ekranındaki mahalle listesi)
    listed: bool = True
    sort_by_distance: bool = True  # False: kaynak sırası korunur (ör. depremler en yeniden eskiye)
    area_circles: bool = False  # haritada her kaydın yerinde renkli daire (ör. hazırlık endeksi)
    sub: Callable[[Item], str] | None = None  # liste alt satırı (verilmezse mahalle, ilçe)

    def color_of(self, it: Item) -> str:
        return self.marker_color(it) if self.marker_color else self.color

    def meta(self) -> dict:
        """Arayüzün menü ve başlık için ihtiyaç duyduğu bilgiler."""
        return {
            "id": self.id,
            "group": self.group,
            "title": self.title,
            "navTitle": self.nav_title or self.title,
            "icon": self.icon,
            "color": self.color,
            "intro": self.intro,
            "cluster": self.cluster,
            "slow": self.slow,
            "noMap": self.no_map,
            "outage": self.outage,
            "areaCircles": self.area_circles,
            "search": self.search,
            "searchPlaceholder": self.search_placeholder,
            "emptyText": self.empty_text,
            "errorText": self.error_text,
            "errorLink": self.error_link,
            "directions": self.directions,
            "routing": self.routing,
            "defaultMode": MODE_NAMES[self.default_mode],
        }


# Arayüzle konuşulan adlar ↔ OSRM profilleri
MODES = {"arac": "driving", "yuruyus": "walking"}
MODE_NAMES = {v: k for k, v in MODES.items()}


def distance_fields(dist: Distance | None) -> dict:
    """Arayüzde gösterilecek mesafe alanları. distKind: 'yol' (araçla) ya da 'kus' (kuş uçuşu)."""
    if dist is None:
        return {}
    if dist.road is not None:
        return {
            "dist": round(dist.road),
            "distText": fmt_dist(dist.road),
            "distKind": "yol",
            "mode": MODE_NAMES[dist.profile],
            "durationText": fmt_duration(dist.duration) if dist.duration is not None else None,
        }
    return {"dist": round(dist.air), "distText": fmt_dist(dist.air), "distKind": "kus", "durationText": None}


def present(layer: Layer, it: Item, dist: Distance | None) -> dict:
    """Bir öğeyi arayüzün doğrudan gösterebileceği biçime çevirir."""
    out = {
        "id": it["id"],
        "name": it.get("name"),
        "lat": it.get("lat"),
        "lng": it.get("lng"),
        "sub": layer.sub(it) if layer.sub else ", ".join(p for p in (it.get("mahalle"), it.get("ilce")) if p) or it.get("address") or it.get("kind") or "",
        "color": layer.color_of(it),
        "badge": layer.badge(it) or None,
        "details": [[k, str(v)] for k, v in layer.details(it) if v not in (None, "")],
        "phone": it.get("phone"),
    }
    out.update(distance_fields(dist))
    if "days" in it:  # pazar yerleri: kurulduğu günler (0 = Pazartesi), hatırlatıcılar için
        out["days"] = it["days"]
    if "price" in it:  # hal fiyatları: arayüz fiyat satırı çizer
        p = it["price"]
        out["price"] = {
            "min": city.fmt_tl(p["min"]), "max": city.fmt_tl(p["max"]), "avg": city.fmt_tl(p["avg"]), "unit": it.get("unit") or "",
        }
        out["kind"] = it.get("kind")
    if layer.no_map or layer.outage:
        out.update({k: it.get(k) for k in ("kind", "ilce", "mahalle", "reason", "duration", "description", "start", "end", "subscribers", "company", "areas", "status", "streets", "shape")})
    return out


def _int(n: int | float) -> str:
    return f"{round(n):,}".replace(",", ".")


def _area(it: Item) -> str:
    return ", ".join(p for p in (it.get("mahalle"), it.get("ilce")) if p)


# ---------- Katmana özel kurallar ----------


def otopark_open(it: Item) -> bool | None:
    """Şu an açık mı? Canlı veride doğrudan, envanterde çalışma saatinden; bilinmiyorsa None."""
    if it.get("live"):
        return it.get("liveOpen", True)
    return parking.is_open_now(it.get("window"))


def otopark_has_space(it: Item) -> bool:
    return bool(it.get("live")) and (it.get("free") or 0) > 0 and otopark_open(it) is not False


def _otopark_color(it: Item) -> str:
    if otopark_open(it) is False:
        return "#8e8e93"
    if it.get("live") and it.get("capacity"):
        if it["free"] == 0:
            return "#ff3b30"
        return "#ff9500" if it["free"] / it["capacity"] < 0.15 else "#34c759"
    return "#007aff" if it["source"] == "izelman" else "#5ac8fa"


def _otopark_badge(it: Item) -> str | None:
    if otopark_open(it) is False:
        return "Şu an kapalı"
    if it.get("live"):
        return f"{it['free']} boş"
    return f"{it['capacity']} araç" if it.get("capacity") else None


def _otopark_stamp(items: list[Item]) -> str:
    izelman = sum(1 for it in items if it["source"] == "izelman")
    live = sum(1 for it in items if it.get("live"))
    return f"{izelman} belediye ({live} canlı doluluk) · {len(items) - izelman} OpenStreetMap"


def _otopark_details(it: Item) -> list[tuple[str, Any]]:
    source = "İzelman (belediye)" + (" · canlı doluluk" if it.get("live") else "") if it["source"] == "izelman" else "OpenStreetMap (doğrulanmamış)"
    return [
        ("Anlık", f"{it['free']} boş · {it['occupied']} dolu" if it.get("live") else None),
        ("Kapasite", f"{it['capacity']} araç" if it.get("capacity") else None),
        ("Tür", it.get("kind")),
        ("Çalışma", it.get("hours")),
        ("Ücret", it.get("fee")),
        ("Gece", it.get("feeNight")),
        ("Aylık abone", it.get("feeMonthly")),
        ("İşletme", it.get("provider")),
        ("Adres", it.get("address")),
        ("Kaynak", source),
    ]


OUTAGE_COLORS = {"Arıza": "#ff9500", "Planlı": "#5856d6"}


def _outage_color(it: Item) -> str:
    return OUTAGE_COLORS.get(it.get("kind"), "#8e8e93")


def _outage_details(it: Item) -> list[tuple[str, Any]]:
    placed = {a["name"] for a in it.get("areas") or []}
    missing = [m for m in (it.get("mahalle") or "").split(", ") if m and m not in placed]
    # Gediz kayıtlarında etkilenen sokaklar mahalle mahalle gelir
    streets = [(f"Sokaklar · {m}", ", ".join(s)) for m, s in (it.get("streets") or {}).items() if s]
    return [
        ("Tür", it.get("kind")),
        ("Durum", it.get("status")),
        ("Mahalleler", it.get("mahalle")),
        ("Zaman", it.get("duration")),
        ("Neden", it.get("reason")),
        ("Etkilenen", f"{it['subscribers']:,} abone".replace(",", ".") if it.get("subscribers") else None),
        ("Açıklama", it.get("description")),
        *streets,
        ("Haritada yok", ", ".join(missing) if missing and placed and not it.get("shape") else None),
        ("Kaynak", it.get("company") or ("İZSU" if str(it.get("id", "")).startswith("su-") else None)),
    ]


def _outage_filters() -> list[Filter]:
    return [
        Filter("all", "Tümü"),
        Filter("ariza", "Arıza", lambda it: it.get("kind") == "Arıza"),
        Filter("planli", "Planlı", lambda it: it.get("kind") == "Planlı"),
    ]


def _pazar_filters() -> list[Filter]:
    d = today_weekday()
    t = (d + 1) % 7
    return [
        Filter("today", f"Bugün ({DAY_NAMES[d]})", lambda it: d in it["days"]),
        Filter("tomorrow", f"Yarın ({DAY_NAMES[t]})", lambda it: t in it["days"]),
        Filter("all", "Tümü"),
    ]


def _pazar_badge(it: Item) -> str | None:
    if not it["days"]:
        return None
    if today_weekday() in it["days"]:
        return "Bugün"
    return ", ".join(DAY_SHORT[d] for d in it["days"])


def _saglik_details(it: Item) -> list[tuple[str, Any]]:
    return [
        ("Tür", it["kind"]),
        ("Not", city.HEALTH_NOTES.get(it["kind"])),
        ("Mahalle", _area(it)),
        ("Adres", it["address"]),
        ("Açıklama", it["note"]),
    ]


def _deniz_color(it: Item) -> str:
    if it["type"] == "korfez":
        return it["levelColor"]
    return city.BLUE_FLAG_COLOR if it["blueFlag"] else city.BEACH_COLOR


def _deniz_badge(it: Item) -> str | None:
    if it["type"] == "korfez":
        return it["level"]
    return "Mavi Bayrak" if it["blueFlag"] else None


def _deniz_sub(it: Item) -> str:
    if it["type"] == "korfez":
        return f"İzmir Körfezi · son ölçüm {fmt_date(it['date'])}"
    return _area(it)


def _deniz_details(it: Item) -> list[tuple[str, Any]]:
    if it["type"] == "korfez":
        return [
            ("Son ölçüm", f"{it['level']} · {fmt_date(it['date'])}"),
            ("E. coli", city.fmt_count(it["ecoli"])),
            ("Bağırsak enterokoku", city.fmt_count(it["entero"])),
            ("Yorum", "Yüzey suyunda tek ölçüm. Yüzme Suyu Kalitesi Yönetmeliği’ndeki “mükemmel” sınırı E. coli 250, enterokok 100; “iyi” sınırı 500 ve 200’dür (100 ml’de). Resmî yüzme suyu sınıfı değildir."),
            ("Kaynak", "İzBB Körfez Değerleri İzleme"),
        ]
    return [
        ("Mavi Bayrak", "Var (uluslararası temiz su ve hizmet sertifikası)" if it["blueFlag"] else None),
        ("Mahalle", _area(it)),
        ("Sorumlu kuruluş", it.get("operator")),
        ("Açıklama", it["note"] if not it["blueFlag"] else None),
    ]


def _hal_stamp(items: list[Item]) -> str | None:
    days = sorted({it["date"][:10] for it in items if it.get("date")})
    return f"Hal bülteni: {fmt_date(days[-1])} · toptan fiyatlar" if days else None


def _hava_stamp(items: list[Item]) -> str | None:
    d = next((it["date"] for it in items if it.get("date")), None)
    return f"Ölçüm tarihi: {fmt_date(d)}" if d else None


def _ug(v: float | None) -> str:
    return f"{v:g} µg/m³" if v is not None else "Ölçüm yok"


LAYERS: list[Layer] = [
    Layer(
        id="eczane",
        group="Sağlık ve afet",
        title="Nöbetçi Eczaneler",
        icon=["Pill"],
        color="#ff3b30",
        ttl=30 * MIN,
        intro="Bugün nöbet tutan eczaneler, size en yakından başlayarak. Liste her sabah 08:00’de yenilenir.",
        load=sources.nobetci_eczaneler,
        stamp=lambda items: f"Nöbet listesi: {fmt_datetime(items[0]['dataDate'])}" if items and items[0].get("dataDate") else None,
        details=lambda it: [
            ("Adres", it["address"]),
            ("Bölge", it["ilce"]),
            ("Not", it["note"]),
            ("Telefon", fmt_phone(it["phone"])),
        ],
    ),
    Layer(
        id="saglik",
        group="Sağlık ve afet",
        title="Sağlık Noktaları",
        icon=["Hospital", "Stethoscope"],
        color="#ff3b30",
        ttl=7 * DAY,
        slow=True,
        cluster=True,
        intro="Hastaneler, aile sağlığı merkezleri, 112 istasyonları, kan merkezleri ve diğer sağlık kurumları. Acil durumda 112’yi arayın.",
        search_placeholder="Kurum, mahalle veya ilçe ara",
        load=city.saglik_noktalari,
        filters=lambda: [
            Filter("hastane", "Hastane", lambda it: it["kind"] == "Hastane"),
            Filter("asm", "Aile hekimi", lambda it: it["kind"] == "Aile Sağlığı Merkezi"),
            Filter("saglik", "Tüm sağlık", lambda it: it["kind"] != "Veteriner"),
            Filter("veteriner", "Veteriner", lambda it: it["kind"] == "Veteriner"),
        ],
        marker_color=lambda it: it["kindColor"],
        badge=lambda it: it["kind"] if it["kind"] not in ("Hastane", "Aile Sağlığı Merkezi", "Veteriner") else None,
        sub=lambda it: " · ".join(p for p in (it["kind"], _area(it)) if p),
        stamp=lambda items: f"{sum(1 for it in items if it['kind'] != 'Veteriner'):,} sağlık kurumu · {sum(1 for it in items if it['kind'] == 'Veteriner'):,} veteriner".replace(",", "."),
        details=_saglik_details,
    ),
    Layer(
        id="toplanma",
        group="Sağlık ve afet",
        title="Toplanma Alanları",
        icon=["Tent", "Users"],
        color="#34c759",
        ttl=7 * DAY,
        cluster=True,
        intro="Deprem ve acil durumlarda gidilecek resmi afet ve acil durum toplanma alanları. En yakınınızdakini önceden bilin; mesafeler yürüyerek hesaplanır.",
        default_mode="walking",
        load=lambda c: sources.cbs(c, "afetaciltoplanmaalani"),
        details=lambda it: [("Mahalle", _area(it)), ("Adres", it["address"]), ("Alan kodu", it["note"])],
    ),
    Layer(
        id="hazirlik",
        group="Sağlık ve afet",
        title="Afet Hazırlık Endeksi",
        nav_title="Hazırlık Endeksi",
        icon=["ShieldCheck"],
        color="#30b0c7",
        ttl=DAY,
        slow=True,
        routing=False,
        area_circles=True,
        # Kullanıcıyı yanlış yönlendirmesin diye menülerden kaldırıldı; mahalle listesi bildirim ekranında kullanılıyor.
        listed=False,
        intro="Deneysel endeks: mahallenin 1 km yakınındaki toplanma alanı başına düşen kişi ve bina sayısı, İzmir'deki diğer mahallelerle kıyaslanır (A en iyi, E en zayıf). Alanların büyüklüğü veride olmadığından güvenlik belgesi değildir.",
        search_placeholder="Mahalle veya ilçe ara",
        load=preparedness.mahalle_hazirlik,
        filters=lambda: [
            Filter("all", "Tümü"),
            Filter("weak", "Zayıf (D–E)", lambda it: it["grade"] in ("D", "E")),
            Filter("good", "İyi (A–B)", lambda it: it["grade"] in ("A", "B")),
        ],
        marker_color=lambda it: it["gradeColor"],
        badge=lambda it: f"{it['grade']} · {it['score']}",
        sub=lambda it: f"{it['ilce']} · 1 km'de {it['near']} alan · alan başına ~{_int(it['perPerson'])} kişi",
        stamp=lambda items: f"{len(items):,} mahalle · deneysel endeks".replace(",", "."),
        details=lambda it: [
            ("Not", f"{it['grade']} · {it['score']}/100 ({it['gradeLabel']})"),
            ("Sıralama", f"{it['rank']:,} / {it['total']:,}".replace(",", ".")),
            ("Nüfus", _int(it["nufus"])),
            ("Bina", _int(it["bina"])),
            ("1 km içinde toplanma alanı", str(it["near"])),
            ("Mahalle içinde", str(it["inside"])),
            ("Alan başına kişi", f"~{_int(it['perPerson'])}"),
            ("Alan başına bina", f"~{_int(it['perBuilding'])}"),
            ("Yöntem", "Toplanma alanı başına kişi (%60) ve bina (%40) yükünün İzmir içindeki yüzdelik sırası. Kaynak: İzBB Açık Veri."),
        ],
    ),
    Layer(
        id="deprem",
        group="Sağlık ve afet",
        title="Son Depremler",
        icon=["Activity"],
        color="#ff3b30",
        ttl=5 * MIN,
        routing=False,
        sort_by_distance=False,
        intro="İzmir ve çevresinde son 7 günün depremleri, en yeniden eskiye (AFAD Deprem Dairesi). Resmî açıklamalar için AFAD’ı takip edin.",
        search_placeholder="İlçe veya yer ara",
        empty_text="Bu aralıkta kayıtlı deprem yok.",
        error_text="AFAD deprem servisine şu anda ulaşılamıyor.",
        error_link={"href": "https://deprem.afad.gov.tr/last-earthquakes", "label": "deprem.afad.gov.tr"},
        load=quakes.son_depremler,
        filters=lambda: [
            Filter("24s", "Son 24 saat", lambda it: quakes.age_hours(it) <= 24),
            Filter("7g", "Son 7 gün"),
            Filter("m3", "M3 ve üstü", lambda it: (it["magnitude"] or 0) >= 3),
        ],
        marker_color=lambda it: quakes.magnitude_color(it["magnitude"]),
        badge=lambda it: f"M {it['magnitude']:.1f}" if it["magnitude"] is not None else None,
        sub=lambda it: " · ".join(p for p in (quakes.when_text(it), f"{quakes.km(it['depth'])} derinlik" if it["depth"] is not None else None) if p),
        stamp=lambda items: f"{len(items)} deprem · en büyüğü M {max((it['magnitude'] or 0) for it in items):.1f}" if items else None,
        details=lambda it: [
            ("Büyüklük", f"{it['magnitude']:.1f} ({it['magType']})" if it["magnitude"] is not None else None),
            ("Zaman", quakes.when_text(it)),
            ("Derinlik", quakes.km(it["depth"])),
            ("Yer", it["place"]),
            ("Kaynak", "AFAD Deprem Dairesi Başkanlığı"),
        ],
    ),
    Layer(
        id="otopark",
        group="Ulaşım",
        title="Otoparklar",
        icon=["SquareParking", "ParkingSquare", "Car"],
        color="#007aff",
        ttl=5 * MIN,
        slow=True,
        cluster=True,
        intro="Belediye (İzelman) otoparkları kapasite, çalışma saati ve ücretleriyle; bir kısmında anlık boş yer bilgisi var. Belediye dışı otoparklar OpenStreetMap’ten gelir.",
        directions="driving",
        load=parking.otoparklar,
        # Varsayılan "Belediye": doğrulanmış, kapasite/ücret bilgisi olan kayıtlar. "Tümü" OpenStreetMap'i de ekler.
        filters=lambda: [
            Filter("izelman", "Belediye", lambda it: it["source"] == "izelman"),
            Filter("space", "Boş yer", otopark_has_space),
            Filter("open", "Şu an açık", lambda it: otopark_open(it) is True),
            Filter("all", "Tümü"),
        ],
        marker_color=_otopark_color,
        badge=_otopark_badge,
        stamp=_otopark_stamp,
        details=_otopark_details,
    ),
    Layer(
        id="taksi",
        group="Ulaşım",
        title="Taksi Durakları",
        icon=["CarTaxiFront", "Car"],
        color="#e0a100",
        ttl=7 * DAY,
        cluster=True,
        intro="Kent genelindeki taksi durakları. Numarası bilinen duraklarda “Ara” düğmesiyle doğrudan taksi çağırabilirsiniz.",
        default_mode="walking",
        load=taxi.taksi_duraklari,
        filters=lambda: [
            Filter("all", "Tümü"),
            Filter("telefon", "Telefonu olan", lambda it: bool(it.get("phone"))),
        ],
        badge=lambda it: "Telefon var" if it.get("phone") else None,
        stamp=lambda items: f"{len(items)} durak · {sum(1 for it in items if it.get('phone'))} durağın telefonu var",
        details=lambda it: [
            ("Telefon", fmt_phone(it.get("phone")) or "Bilinmiyor"),
            ("Telefon kaynağı", it.get("phoneSource")),
            ("Mahalle", _area(it)),
            ("Adres", it["address"]),
            ("Not", it["note"]),
        ],
    ),
    Layer(
        id="pazar",
        group="Günlük yaşam",
        title="Semt Pazarları",
        icon=["ShoppingBasket"],
        color="#ff9500",
        ttl=7 * DAY,
        cluster=True,
        intro="Semt pazar yerleri ve kuruldukları günler. Varsayılan olarak bugün kurulanlar gösterilir.",
        default_mode="walking",
        load=sources.pazar_yerleri,
        filters=_pazar_filters,
        badge=_pazar_badge,
        details=lambda it: [
            ("Kurulduğu gün", ", ".join(DAY_NAMES[d] for d in it["days"]) or "Belirtilmemiş"),
            ("Mahalle", _area(it)),
            ("Adres", it["address"]),
            ("Açıklama", it["note"]),
        ],
    ),
    Layer(
        id="hal",
        group="Günlük yaşam",
        title="Hal Fiyatları",
        icon=["Carrot", "Apple"],
        color="#34c759",
        ttl=3 * HOUR,
        no_map=True,
        routing=False,
        sort_by_distance=False,
        intro="İzmir hallerinde bugünkü (ya da son bültendeki) toptan fiyatlar: en düşük, en yüksek ve ortalama. Pazardaki perakende fiyat genelde daha yüksektir; pazarlık için referans olarak kullanın.",
        search_placeholder="Ürün ara (ör. domates)",
        empty_text="Bu gün için hal bülteni yayımlanmamış.",
        error_text="Hal fiyatlarına şu anda ulaşılamıyor. Hafta sonu ve resmî tatillerde bülten yayımlanmaz.",
        load=city.hal_fiyatlari,
        filters=lambda: [
            Filter("sebze", "Sebze", lambda it: it["kind"] == "Sebze"),
            Filter("meyve", "Meyve", lambda it: it["kind"] in ("Meyve", "İthal")),
            Filter("balik", "Balık", lambda it: it["kind"] == "Balık"),
            Filter("all", "Tümü"),
        ],
        badge=lambda it: f"{city.fmt_tl(it['price']['avg'])} / {it['unit'].lower()}" if it["price"]["avg"] is not None else None,
        stamp=_hal_stamp,
    ),
    Layer(
        id="deniz",
        group="Günlük yaşam",
        title="Deniz ve Plajlar",
        icon=["Waves"],
        color="#007aff",
        ttl=DAY,
        cluster=True,
        intro="Halk plajları ve Mavi Bayraklı plajlar. “Körfez suyu” filtresi, belediyenin İzmir Körfezi’ndeki istasyonlarında ölçülen son bakteri değerlerini gösterir.",
        search_placeholder="Plaj, mahalle veya ilçe ara",
        load=city.deniz,
        filters=lambda: [
            Filter("plaj", "Plajlar", lambda it: it["type"] == "plaj"),
            Filter("mavi", "Mavi Bayraklı", lambda it: it["type"] == "plaj" and it["blueFlag"]),
            Filter("korfez", "Körfez suyu", lambda it: it["type"] == "korfez"),
        ],
        marker_color=_deniz_color,
        badge=_deniz_badge,
        sub=_deniz_sub,
        stamp=lambda items: (
            f"{sum(1 for it in items if it['type'] == 'plaj')} plaj ({sum(1 for it in items if it.get('blueFlag'))} Mavi Bayraklı)"
            + (f" · körfez son ölçüm {fmt_date(max(it['date'] for it in items if it['type'] == 'korfez'))}" if any(it["type"] == "korfez" for it in items) else "")
        ),
        details=_deniz_details,
    ),
    Layer(
        id="wifi",
        group="Günlük yaşam",
        title="Ücretsiz Wi-Fi",
        icon=["Wifi"],
        color="#af52de",
        ttl=7 * DAY,
        cluster=True,
        intro="Belediyenin ücretsiz internet hizmeti WizmirNET erişim noktaları.",
        default_mode="walking",
        load=lambda c: sources.cbs(c, "wizmirnetnoktalari"),
        details=lambda it: [("Mahalle", _area(it)), ("Konum", it["address"]), ("Not", it["note"])],
    ),
    Layer(
        id="su",
        group="Çevre ve altyapı",
        title="Su Kesintileri",
        icon=["Droplets", "Droplet"],
        color="#32ade6",
        ttl=10 * MIN,
        outage=True,
        routing=False,
        intro="İZSU’nun arıza kaynaklı ve planlı su kesintileri. Mahallenizi aratabilirsiniz.",
        search_placeholder="Mahalle veya ilçe ara",
        empty_text="Şu anda duyurulmuş bir su kesintisi yok.",
        error_text="İZSU kesinti bilgisine şu anda ulaşılamıyor. Güncel duyurular için İZSU’nun sitesine bakabilirsiniz.",
        error_link={"href": outages.IZSU_PAGE, "label": "izsu.gov.tr"},
        load=outages.su_kesintileri,
        filters=_outage_filters,
        badge=lambda it: it.get("kind"),
        marker_color=_outage_color,
        details=_outage_details,
    ),
    Layer(
        id="elektrik",
        group="Çevre ve altyapı",
        title="Elektrik Kesintileri",
        icon=["Zap"],
        color="#5856d6",
        ttl=15 * MIN,
        outage=True,
        routing=False,
        intro="Gediz Elektrik’in şu anki arıza kesintileri ile önümüzdeki günlerin planlı kesintileri; etkilenen sokaklarla. Haritadaki alanlar etkilenen sokakları kapsar.",
        search_placeholder="Mahalle, ilçe veya sokak ara",
        empty_text="Şu anda duyurulmuş bir elektrik kesintisi yok.",
        error_text="Gediz Elektrik’in kesinti servisine şu anda ulaşılamıyor. Güncel bilgi için Gediz’in sitesine bakabilir ya da 186’yı arayabilirsiniz.",
        error_link={"href": "https://www.gdzelektrik.com.tr/bilgi-merkezi/planli-bakim-ve-iyilestirme-calismalari", "label": "Gediz planlı kesintiler"},
        load=outages.elektrik_kesintileri,
        filters=_outage_filters,
        badge=lambda it: it.get("kind"),
        marker_color=_outage_color,
        details=_outage_details,
    ),
    Layer(
        id="hava",
        group="Çevre ve altyapı",
        title="Hava Kalitesi",
        icon=["Wind"],
        color="#30b0c7",
        ttl=HOUR,
        search=False,
        routing=False,
        intro="Belediyenin ölçüm istasyonlarındaki günlük PM10 ve SO2 değerleri (µg/m³). Renkler Türkiye Hava Kalitesi İndeksi’ne göre.",
        load=sources.hava_kalitesi,
        stamp=_hava_stamp,
        marker_color=lambda it: it["level"]["color"],
        badge=lambda it: f"PM10 {it['pm10']:g}" if it["pm10"] is not None else "Veri yok",
        details=lambda it: [
            ("Durum", it["level"]["label"]),
            ("PM10", _ug(it["pm10"])),
            ("SO2", _ug(it["so2"])),
            ("İlçe", it["ilce"]),
            ("Ölçüm tarihi", fmt_date(it["date"])),
        ],
    ),
]

LAYER_BY_ID = {layer.id: layer for layer in LAYERS}
