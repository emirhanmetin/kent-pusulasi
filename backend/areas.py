"""Mahalle adından yaklaşık konum.

Kesinti kayıtlarında (su, elektrik) koordinat yok; yalnızca ilçe ve mahalle adları var. Belediyenin
konumlu verilerinde (toplanma alanları, pazar yerleri, taksi durakları, WizmirNET noktaları) her kaydın
mahallesi de bulunduğundan, bir mahallenin yaklaşık merkezi o mahalledeki noktaların ortalaması olarak
alınır. Harici bir adres servisine (geocoding) gerek kalmaz.

Mahallenin yaklaşık büyüklüğü (r, metre) de aynı noktaların merkeze uzaklığından çıkarılır; haritadaki
kesinti dairesi böylece küçük mahallede küçük, geniş mahallede geniş çizilir. Az noktalı mahallede r verilmez.

Adı eşleşmeyen mahalle için konum uydurulmaz; o kayıt yalnızca listede görünür.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from .geo import haversine
from .text import tr_lower

Item = dict[str, Any]


def norm(name: str | None) -> str:
    """'Refik Şevket İnce Mahallesi' -> 'refikşevketince' (karşılaştırma anahtarı)."""
    t = tr_lower(name)
    t = re.sub(r"\b(mahallesi|mahalle|mah)\b\.?", " ", t)
    return re.sub(r"[^a-zçğıöşü0-9]", "", t)


def split_neighbourhoods(text: str | None) -> list[str]:
    return [p.strip() for p in re.split(r"[,;]", text or "") if p.strip()]


MIN_POINTS_FOR_RADIUS = 3
RADIUS_PAD = 150  # m: en dıştaki noktalar dairenin tam kenarında kalmasın
RADIUS_MIN, RADIUS_MAX = 300, 1500  # m


def spread_radius(centre: tuple[float, float], pts: list[tuple[float, float]]) -> int | None:
    """Noktaların %80'ini kapsayan uzaklık + pay; uç değerler (yanlış mahalle yazılmış nokta) dışarıda kalır."""
    if len(pts) < MIN_POINTS_FOR_RADIUS:
        return None
    dists = sorted(haversine(centre[0], centre[1], lat, lng) for lat, lng in pts)
    r = dists[min(len(dists) - 1, int(len(dists) * 0.8))] + RADIUS_PAD
    return round(min(RADIUS_MAX, max(RADIUS_MIN, r)))


class AreaIndex:
    def __init__(self, point_sets: Iterable[Iterable[Item]]):
        acc: dict[tuple[str, str], list[tuple[float, float]]] = {}
        for points in point_sets:
            for p in points:
                if not p.get("mahalle") or p.get("lat") is None or p.get("lng") is None:
                    continue
                acc.setdefault((norm(p.get("ilce")), norm(p["mahalle"])), []).append((p["lat"], p["lng"]))
        self._centres = {k: (sum(a for a, _ in pts) / len(pts), sum(b for _, b in pts) / len(pts)) for k, pts in acc.items()}
        self._radius = {k: spread_radius(self._centres[k], pts) for k, pts in acc.items()}

    def __len__(self) -> int:
        return len(self._centres)

    def lookup(self, ilce: str | None, mahalle: str | None) -> tuple[float, float] | None:
        return self._centres.get((norm(ilce), norm(mahalle)))

    def radius(self, ilce: str | None, mahalle: str | None) -> int | None:
        return self._radius.get((norm(ilce), norm(mahalle)))


def place_outages(items: list[Item], index: AreaIndex, lat: float | None = None, lng: float | None = None) -> list[Item]:
    """Her kesintiye etkilenen mahallelerin konumlarını (areas) ekler.

    Kaydın kendi konumu (lat/lng) olarak mahallelerin ortalaması DEĞİL, kullanıcıya en yakın etkilenen
    mahalle alınır: ortalama nokta, birbirinden uzak mahallelerde hiçbir dairenin üstüne düşmez. Böylece
    işaret her zaman bir dairenin ortasında durur ve mesafe "en yakın etkilenen mahalleye" göre hesaplanır.
    """
    out = []
    for it in items:
        shape = it.get("shape")
        if shape:  # Gediz kaydı: etkilenen alanın kendi çokgeni var, mahalle merkezine gerek yok
            lng, lat = shape["center"]
            r = max(haversine(lat, lng, p[1], p[0]) for p in shape["ring"])
            area = {"name": it.get("mahalle") or "", "lat": round(lat, 6), "lng": round(lng, 6), "r": round(max(150, r))}
            out.append(dict(it, areas=[area], lat=area["lat"], lng=area["lng"]))
            continue
        areas = []
        for m in split_neighbourhoods(it.get("mahalle")):
            p = index.lookup(it.get("ilce"), m)
            if p:
                area = {"name": m, "lat": round(p[0], 6), "lng": round(p[1], 6)}
                r = index.radius(it.get("ilce"), m)
                if r:
                    area["r"] = r
                areas.append(area)
        placed = dict(it, areas=areas)
        if areas:
            rep = min(areas, key=lambda a: haversine(lat, lng, a["lat"], a["lng"])) if lat is not None and lng is not None else areas[0]
            placed["lat"], placed["lng"] = rep["lat"], rep["lng"]
        out.append(placed)
    return out
