"""Harita işaretleri için Material Symbols simgelerini PNG'ye çevirir (assets/map-icons/).

MapLibre işaretleri haritanın kendi katmanında çizer; bunun için simgelerin görsel dosyası gerekir.
Hangi simgelerin üretileceği src/lib/categories.ts içindeki `android: '...'` adlarından okunur.

Çalıştırma (mobile-android klasöründe):  python scripts/harita_simgeleri.py
"""

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'node_modules/@expo-google-fonts/material-symbols/600SemiBold/MaterialSymbols_600SemiBold.ttf'
CODES = json.loads((ROOT / 'node_modules/expo-symbols/build/android/symbols.json').read_text(encoding='utf-8'))
OUT = ROOT / 'assets/map-icons'
SIZE = 96  # px; haritada icon-size ile küçültülür

names = sorted(set(re.findall(r"android: '([a-z0-9_]+)'", (ROOT / 'src/lib/categories.ts').read_text(encoding='utf-8'))))
OUT.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype(str(FONT), int(SIZE * 0.86))
index = []
for name in names:
    if name not in CODES:
        print('bulunamadı:', name)
        continue
    img = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.text((SIZE / 2, SIZE / 2), chr(CODES[name]), font=font, fill=(255, 255, 255, 255), anchor='mm')
    img.save(OUT / f'{name}.png')
    index.append(name)

# Seçili işaretin altındaki uç (iOS'taki balon gibi): beyaz, aşağı bakan üçgen (haritada 12×9 görünür)
tail = Image.new('RGBA', (SIZE, SIZE * 3 // 4), (255, 255, 255, 0))
ImageDraw.Draw(tail).polygon([(0, 0), (SIZE, 0), (SIZE / 2, SIZE * 3 / 4)], fill=(255, 255, 255, 255))
tail.save(OUT / 'pin_tail.png')
index.append('pin_tail')

# Uygulamanın require() ile yükleyeceği liste (Metro dinamik require desteklemez)
lines = ['// Bu dosya scripts/harita_simgeleri.py ile üretilir; elle düzenlemeyin.', 'export const MAP_ICONS = {']
lines += [f"  '{n}': require('../../assets/map-icons/{n}.png')," for n in index]
lines += ['} as const;', '']
(ROOT / 'src/lib/mapIcons.ts').write_text('\n'.join(lines), encoding='utf-8')
print(len(index), 'simge üretildi')
