"""Mahalle afet hazırlık endeksi (deneysel).

Soru: "Deprem sonrası bu mahallede toplanma alanı başına kaç kişi ve kaç bina düşüyor?"

Veriler (İzBB Açık Veri):
  - İlçelere Ait Mahalle Bazlı Bina Sayıları (YAPI)
  - Cinsiyete Göre Mahalle Nüfus Bilgileri (erkek + kadın)
  - Afet ve Acil Durum Toplanma Alanları (konumlu)
  - Mahalle merkezleri: konumlu belediye verilerinden (bkz. areas.py)

Yöntem:
  1. Her mahallenin yaklaşık merkezine 1 km içindeki toplanma alanları sayılır (komşu mahallelerdekiler
     dahil; insanlar deprem anında mahalle sınırına bakmaz).
  2. yük_kişi = nüfus / alan sayısı,  yük_bina = bina / alan sayısı  (alan yoksa 0,5 kabul edilir).
  3. İki yük, İzmir'deki tüm mahalleler içinde yüzdelik sıraya çevrilir (düşük yük = iyi) ve
     0,6·kişi + 0,4·bina ağırlığıyla 0-100 puana dönüştürülür. Not: A ≥ 80, B ≥ 60, C ≥ 40, D ≥ 20, E < 20.

Sınırlar (uygulamada da gösterilir): toplanma alanlarının büyüklüğü/kapasitesi veride yok; mahalle merkezi
yaklaşık; mesafe kuş uçuşu; nüfus 2023 verisi. Bu nedenle endeks karşılaştırma içindir, güvenlik belgesi değildir.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from typing import Any

import httpx

from .areas import AreaIndex, norm
from .geo import haversine
from .parking import _cached, _dataset_csvs
from .sources import cbs, num
from .text import title_case

log = logging.getLogger("kent.hazirlik")
Item = dict[str, Any]

RADIUS = 1000  # m
W_PERSON, W_BUILDING = 0.6, 0.4
GRADES = [(80, "A", "#34c759", "Çok iyi"), (60, "B", "#30b0c7", "İyi"), (40, "C", "#e0a100", "Orta"), (20, "D", "#ff9500", "Zayıf"), (0, "E", "#ff3b30", "Çok zayıf")]
BUILDING_DATASET = "ilcelere-ait-mahalle-bazli-bina-sayilari"
POPULATION_DATASET = "cinsiyete-gore-mahalle-nufus-bilgileri"


def grade(score: float) -> tuple[str, str, str]:
    for limit, letter, color, label in GRADES:
        if score >= limit:
            return letter, color, label
    return GRADES[-1][1:]


def _percentile_ranks(values: list[float]) -> list[float]:
    """0 (en kötü = en yüksek yük) … 1 (en iyi = en düşük yük); eşit değerler aynı sırayı alır."""
    order = sorted(values)
    n = len(values)
    pos: dict[float, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and order[j + 1] == order[i]:
            j += 1
        pos[order[i]] = ((i + j) / 2) / max(n - 1, 1)
        i = j + 1
    return [1 - pos[v] for v in values]


class _Grid:
    """Toplanma alanlarını ~1 km'lik hücrelere koyar; "1 km içinde kaç alan" sorusu hızlanır."""

    CELL = 0.01  # derece (~1,1 km enlem)

    def __init__(self, points: list[tuple[float, float]]):
        self.cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
        for lat, lng in points:
            self.cells[(int(lat / self.CELL), int(lng / self.CELL))].append((lat, lng))

    def count_within(self, lat: float, lng: float, radius: float) -> int:
        cy, cx = int(lat / self.CELL), int(lng / self.CELL)
        span = math.ceil(radius / 1000) + 1
        return sum(
            1
            for dy in range(-span, span + 1)
            for dx in range(-span, span + 1)
            for p in self.cells.get((cy + dy, cx + dx), ())
            if haversine(lat, lng, p[0], p[1]) <= radius
        )


async def _population_rows(client: httpx.AsyncClient) -> list[dict]:
    files = await _dataset_csvs(client, POPULATION_DATASET)
    # En güncel yıl: adında yıl geçmeyen dosya (ör. ...nufuslari.csv; eskiler ...-2022.csv)
    name = next((n for n in files if not any(y in n for y in ("2021", "2022"))), next(iter(files), None))
    return files.get(name, []) if name else []


async def mahalle_hazirlik(client: httpx.AsyncClient) -> list[Item]:
    toplanma = await cbs(client, "afetaciltoplanmaalani")
    others = [await cbs(client, n) for n in ("pazaryerleri", "taksiduraklari", "wizmirnetnoktalari")]
    index = AreaIndex([toplanma, *others])
    buildings = next(iter((await _cached("hazirlik-bina", lambda: _dataset_csvs(client, BUILDING_DATASET))).values()), [])
    population = await _cached("hazirlik-nufus", lambda: _population_rows(client))

    rows: dict[tuple[str, str], dict] = {}
    for r in buildings:
        key = (norm(r.get("ILCE")), norm(r.get("MAHALLE")))
        rows[key] = {"ilce": title_case(r.get("ILCE")), "mahalle": title_case(r.get("MAHALLE")), "bina": int(num(r.get("YAPI")) or 0)}
    for r in population:
        key = (norm(r.get("ILCE_ADI")), norm(r.get("MAHALLE_ADI")))
        people = int((num(r.get("NUFUS_ERKEK_TOPLAM")) or 0) + (num(r.get("NUFUS_KADIN_TOPLAM")) or 0))
        rows.setdefault(key, {"ilce": title_case(r.get("ILCE_ADI")), "mahalle": title_case(r.get("MAHALLE_ADI")), "bina": 0})["nufus"] = people

    inside: dict[tuple[str, str], int] = defaultdict(int)
    for p in toplanma:
        inside[(norm(p["ilce"]), norm(p["mahalle"]))] += 1
    grid = _Grid([(p["lat"], p["lng"]) for p in toplanma])

    placed = []
    for key, row in rows.items():
        centre = index.lookup(*key)
        if centre is None or "nufus" not in row or row["nufus"] <= 0:
            continue
        # Geniş (kırsal) mahallelerde merkez alanlardan uzak kalabilir: mahalle içindeki alanlar en az sayılır.
        near = max(grid.count_within(centre[0], centre[1], RADIUS), inside.get(key, 0))
        denom = max(near, 0.5)
        placed.append({
            **row,
            "key": key,
            "lat": round(centre[0], 6),
            "lng": round(centre[1], 6),
            "inside": inside.get(key, 0),
            "near": near,
            "perPerson": row["nufus"] / denom,
            "perBuilding": row["bina"] / denom,
        })

    if not placed:
        raise RuntimeError("hazırlık endeksi için veri yok")
    p_rank = _percentile_ranks([m["perPerson"] for m in placed])
    b_rank = _percentile_ranks([m["perBuilding"] for m in placed])
    for m, pr, br in zip(placed, p_rank, b_rank):
        m["score"] = round(100 * (W_PERSON * pr + W_BUILDING * br))
    placed.sort(key=lambda m: -m["score"])
    items = []
    for rank, m in enumerate(placed, 1):
        letter, color, label = grade(m["score"])
        items.append({
            "id": f"hazirlik-{m['key'][0]}-{m['key'][1]}",
            "name": m["mahalle"],
            "ilce": m["ilce"],
            "mahalle": m["mahalle"],
            "lat": m["lat"],
            "lng": m["lng"],
            "score": m["score"],
            "grade": letter,
            "gradeColor": color,
            "gradeLabel": label,
            "nufus": m["nufus"],
            "bina": m["bina"],
            "inside": m["inside"],
            "near": m["near"],
            "perPerson": round(m["perPerson"]),
            "perBuilding": round(m["perBuilding"]),
            "rank": rank,
            "total": len(placed),
        })
    log.info("hazırlık endeksi: %d mahalle (konumu bulunamayan: %d)", len(items), len(rows) - len(items))
    return items
