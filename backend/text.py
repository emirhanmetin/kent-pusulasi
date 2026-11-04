"""Türkçe metin, tarih ve biçimlendirme yardımcıları."""

from __future__ import annotations

import re
import time
from datetime import datetime

# Python'da datetime.weekday(): Pazartesi = 0 ... Pazar = 6
DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
DAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]
MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

# str.lower() Türkçede yanlış çalışır: "I" -> "i" (ı olmalı), "İ" -> "i̇" (noktalı birleşik karakter).
_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})
_TR_UPPER = str.maketrans({"i": "İ", "ı": "I"})


def tr_lower(s: str | None) -> str:
    return (s or "").translate(_TR_LOWER).lower()


def tr_upper(s: str | None) -> str:
    return (s or "").translate(_TR_UPPER).upper()


def title_case(s: str | None) -> str:
    """'ESRA BAY ECZANESİ' -> 'Esra Bay Eczanesi'. Rakam içeren kelimelere (No:27/1A) dokunmaz."""
    words = []
    for w in str(s or "").split():
        if any(c.isdigit() for c in w):
            words.append(w)
        else:
            words.append(re.sub(r"(^|[(/.\-'])(\w)", lambda m: m.group(1) + tr_upper(m.group(2)), tr_lower(w)))
    return " ".join(words)


def today_weekday() -> int:
    return datetime.now().weekday()


def parse_market_days(text: str | None) -> list[int]:
    """Pazar yeri açıklamasından kurulma günlerini çıkarır (0 = Pazartesi).

    Örnekler: "Cumartesi  günü kurulmaktadır", "Çarşamba ve Cuma günleri kurulmaktadır."
    Dikkat: "pazar" hem gün adı hem "pazar yeri" anlamında geçiyor.
    """
    t = re.sub(r"\s+", " ", tr_lower(text))
    days: set[int] = set()
    if "pazartesi" in t:
        days.add(0)
    if re.search(r"(^|[^a-zçğıöşü])salı", t):
        days.add(1)
    if "çarşamba" in t:
        days.add(2)
    if "perşembe" in t:
        days.add(3)
    if re.search(r"cuma(?!rtesi)", t):
        days.add(4)
    if "cumartesi" in t:
        days.add(5)
    if re.search(r"(^|[^a-zçğıöşü])pazar (günü|günleri|gün)", t):
        days.add(6)
    return sorted(days)


def pm10_level(v: float | None) -> dict:
    """Türkiye Hava Kalitesi İndeksi, PM10 (24 saatlik, µg/m³) eşikleri."""
    if v is None:
        return {"label": "Ölçüm yok", "color": "#8e8e93"}
    for limit, label, color in (
        (50, "İyi", "#34c759"),
        (100, "Orta", "#e0a100"),
        (260, "Hassas gruplar için sağlıksız", "#ff9500"),
        (400, "Sağlıksız", "#ff3b30"),
        (520, "Kötü", "#af52de"),
    ):
        if v <= limit:
            return {"label": label, "color": color}
    return {"label": "Tehlikeli", "color": "#a2281e"}


def fmt_phone(p: str | None) -> str | None:
    """'02324585852' -> '0232 458 58 52'"""
    d = re.sub(r"\D", "", p or "")
    return f"{d[:4]} {d[4:7]} {d[7:9]} {d[9:]}" if len(d) == 11 else p


def _parse_iso(iso: str) -> datetime | None:
    try:
        return datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None


def fmt_date(iso: str | None) -> str | None:
    d = _parse_iso(iso or "")
    return f"{d.day} {MONTHS[d.month - 1]}" if d else None


def fmt_datetime(iso: str | None) -> str | None:
    d = _parse_iso(iso or "")
    return f"{d.day} {MONTHS[d.month - 1]} {d:%H:%M}" if d else None


def time_ago(ts: float) -> str:
    s = time.time() - ts
    if s < 60:
        return "az önce"
    if s < 3600:
        return f"{round(s / 60)} dk önce"
    if s < 86400:
        return f"{round(s / 3600)} sa önce"
    d = datetime.fromtimestamp(ts)
    return f"{d.day} {MONTHS[d.month - 1]}"
