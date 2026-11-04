"""'Yakınımda' ekranının kartları: her katmandan kullanıcıya en uygun tek kayıt."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .geo import fmt_dist, fmt_duration
from .layers import otopark_has_space
from .routing import Distance
from .text import DAY_NAMES, fmt_date, today_weekday

Item = dict[str, Any]


def describe(d: Distance) -> str:
    """'2,3 km yol · ~6 dk araçla' ya da yol mesafesi yoksa '1,2 km kuş uçuşu'."""
    if d.road is not None:
        how = "yürüyerek" if d.profile == "walking" else "araçla"
        return f"{fmt_dist(d.road)} yol · ~{fmt_duration(d.duration)} {how}" if d.duration is not None else f"{fmt_dist(d.road)} yol"
    return f"{fmt_dist(d.air)} kuş uçuşu"


@dataclass
class Card:
    id: str
    layer: str
    label: Callable[[], str]
    main: Callable[[Item, Distance], str]
    sub: Callable[[Item, Distance], str]
    # Aday kayıtları süzer (ör. bugün kurulan pazarlar). Yol mesafesi süzülmüş adaylar arasında hesaplanır.
    pred: Callable[[Item], bool] = field(default=lambda it: True)
    # pred'e uyan kayıt yoksa en yakın herhangi bir kayıt gösterilsin mi
    fallback_any: bool = False
    none: str = "Kayıt bulunamadı"


CARDS: list[Card] = [
    Card(
        "eczane", "eczane", lambda: "En yakın nöbetçi eczane",
        main=lambda it, d: it["name"],
        sub=lambda it, d: describe(d),
    ),
    Card(
        "hastane", "saglik", lambda: "En yakın hastane",
        pred=lambda it: it["kind"] == "Hastane",
        main=lambda it, d: it["name"],
        sub=lambda it, d: describe(d),
        none="Yakında hastane bulunamadı",
    ),
    Card(
        "toplanma", "toplanma", lambda: "En yakın toplanma alanı",
        main=lambda it, d: it["name"],
        sub=lambda it, d: f"{it['mahalle']}, {it['ilce']} · {describe(d)}",
    ),
    Card(
        "pazar", "pazar", lambda: f"Bugün kurulan en yakın pazar ({DAY_NAMES[today_weekday()]})",
        pred=lambda it: today_weekday() in it["days"],
        main=lambda it, d: it["name"],
        sub=lambda it, d: f"{it['mahalle'] + ' · ' if it['mahalle'] else ''}{describe(d)}",
        none="Bugün kurulan pazar bulunamadı",
    ),
    Card(
        "otopark", "otopark", lambda: "Boş yeri olan en yakın otopark",
        pred=otopark_has_space,
        main=lambda it, d: it["name"],
        sub=lambda it, d: f"{it['free']} boş yer · {describe(d)}",
        none="Şu an boş yer bildiren otopark yok",
    ),
    Card(
        "hava", "hava", lambda: "Hava kalitesi (ölçüm yapan en yakın istasyon)",
        pred=lambda it: it["pm10"] is not None,
        fallback_any=True,
        main=lambda it, d: f"{it['name']}: {it['level']['label']}",
        sub=lambda it, d: f"PM10 {'—' if it['pm10'] is None else format(it['pm10'], 'g')} µg/m³"
        + (f" · {fmt_date(it['date'])}" if it.get("date") else ""),
    ),
]

CARD_BY_ID = {c.id: c for c in CARDS}

# Kesinti kartları konuma değil, tahmini ilçeye göre çalışır (main.py içinde).
OUTAGE_CARDS = [
    {"id": "su", "layer": "su", "label": "Su kesintisi (ilçenizde)"},
    {"id": "elektrik", "layer": "elektrik", "label": "Elektrik kesintisi (ilçenizde)"},
]
