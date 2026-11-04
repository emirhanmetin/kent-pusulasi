"""Uygulama simgesi ve açılış ekranı görsellerini üretir (mobile/assets).

Kullanım:  .venv\\Scripts\\pip install pillow
           .venv\\Scripts\\python scripts\\ikon_uret.py

Tasarım: mavi degrade zemin, beyaz konum iğnesi, içinde pusula yıldızı. Bir tasarımcının simgesiyle
değiştirmek için aynı dosya adlarıyla 1024x1024 PNG koymanız yeterli (iOS simgesinde saydamlık olmamalı).
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "mobile" / "assets"
SS = 4  # süper örnekleme (kenar yumuşatma)
BLUE_LIGHT = (90, 200, 250)
BLUE = (0, 122, 255)
BLUE_DARK = (10, 88, 204)
WHITE = (255, 255, 255)


def gradient(size: int) -> Image.Image:
    """Sol üstten sağ alta açık maviden koyu maviye degrade."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(BLUE_LIGHT, BLUE_DARK))
    return img


def pin_polygon(cx: float, cy: float, r: float, tip_y: float) -> list[tuple[float, float]]:
    """Daire + aşağı sivri uç: dairenin, uca teğet iki noktası ile uç arasındaki üçgen."""
    d = tip_y - cy
    phi = math.acos(r / d)
    return [(cx - r * math.sin(phi), cy + r * math.cos(phi)), (cx, tip_y), (cx + r * math.sin(phi), cy + r * math.cos(phi))]


def star(cx: float, cy: float, outer: float, inner: float, points: int = 4, rot: float = -90) -> list[tuple[float, float]]:
    pts = []
    for i in range(points * 2):
        rad = outer if i % 2 == 0 else inner
        a = math.radians(rot + i * 180 / points)
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return pts


def draw_glyph(d: ImageDraw.ImageDraw, size: int, pin_color, disk_color, star_color, scale: float = 1.0) -> None:
    """size'lık tuvalin ortasına iğne + disk + yıldız çizer. scale: 1 = simge oranı."""
    c = size / 2
    r = size * 0.235 * scale
    cy = c - size * 0.07 * scale
    tip = cy + size * 0.40 * scale
    d.ellipse([c - r, cy - r, c + r, cy + r], fill=pin_color)
    d.polygon(pin_polygon(c, cy, r, tip), fill=pin_color)
    rd = r * 0.64
    d.ellipse([c - rd, cy - rd, c + rd, cy + rd], fill=disk_color)
    d.polygon(star(c, cy, rd * 0.78, rd * 0.22), fill=star_color)


def map_lines(d: ImageDraw.ImageDraw, size: int) -> None:
    """Zeminde silik 'harita yolları'."""
    col = (255, 255, 255, 38)
    w = int(size * 0.018)
    d.line([(0, size * 0.72), (size, size * 0.28)], fill=col, width=w)
    d.line([(size * 0.18, 0), (size * 0.44, size)], fill=col, width=int(w * 0.7))
    d.line([(0, size * 0.18), (size, size * 0.52)], fill=col, width=int(w * 0.6))


def icon() -> Image.Image:
    big = 1024 * SS
    base = gradient(256).resize((big, big), Image.BICUBIC).convert("RGBA")
    overlay = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    map_lines(ImageDraw.Draw(overlay), big)
    base = Image.alpha_composite(base, overlay)
    draw_glyph(ImageDraw.Draw(base), big, WHITE, BLUE, WHITE)
    return base.resize((1024, 1024), Image.LANCZOS).convert("RGB")  # iOS: saydamlık yok


def glyph_transparent(scale: float, pin, disk, star_col) -> Image.Image:
    big = 1024 * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_glyph(ImageDraw.Draw(img), big, pin, disk, star_col, scale)
    return img.resize((1024, 1024), Image.LANCZOS)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    icon().save(ASSETS / "icon.png")
    # Açılış ekranı: açık ve koyu zeminde okunan mavi iğne
    glyph_transparent(1.0, BLUE, WHITE, BLUE).save(ASSETS / "splash-icon.png")
    # Android uyarlanabilir simge: güvenli alan için küçültülmüş
    glyph_transparent(0.62, WHITE, BLUE, WHITE).save(ASSETS / "android-icon-foreground.png")
    gradient(512).resize((1024, 1024), Image.BICUBIC).save(ASSETS / "android-icon-background.png")
    glyph_transparent(0.62, WHITE, (0, 0, 0, 0), WHITE).save(ASSETS / "android-icon-monochrome.png")
    icon().resize((48, 48), Image.LANCZOS).save(ASSETS / "favicon.png")
    print("Üretildi:", ", ".join(p.name for p in sorted(ASSETS.glob("*.png"))))


if __name__ == "__main__":
    main()
