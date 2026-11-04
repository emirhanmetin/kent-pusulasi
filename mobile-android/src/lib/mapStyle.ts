// Harita altlığı: OpenFreeMap "liberty" vektör stili. iOS'taki Apple Haritalar gibi işletme/POI simgeleri gizlenir.
// Koyu tema aynı stilden yeniden renklendirilir (OpenFreeMap'in hazır koyu stili neredeyse simsiyah).
// Uydu görünümü yok: Esri görüntüsü uygulamada kullanım için ticari lisans/anahtar ister.
import { useEffect, useState } from 'react';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';

type Variant = 'light' | 'dark';

// Anahtar gerekmez; atıf harita üzerinde gösterilir.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Stil indirilemezse MapLibre'nin kendi önbelleğinden açılacak hazır stiller
const FALLBACK_URLS = { light: STYLE_URL, dark: 'https://tiles.openfreemap.org/styles/dark' };
const FETCH_TIMEOUT_MS = 4000;

const sourceLayer = (l: LayerSpecification) => ('source-layer' in l ? l['source-layer'] : undefined);

/** Apple Haritalar'daki showsPointsOfInterests={false} gibi: dükkân, restoran vb. simgeleri kaldır. */
function withoutPois(style: StyleSpecification): StyleSpecification {
  return { ...style, layers: style.layers.filter((l) => sourceLayer(l) !== 'poi') };
}

// Apple Haritalar koyu moduna yakın tonlar: koyu gri kara, lacivert deniz, koyu yeşil park, okunur gri yollar
const DARK = {
  land: '#2a2c30',
  landAlt: '#303236', // okul, hastane, mezarlık, havaalanı alanları
  water: '#1b2c3e',
  green: '#253429',
  sand: '#35332d',
  building: '#383b40',
  buildingEdge: '#43464c',
  casing: '#232528',
  motorway: '#7a6f52',
  major: '#5f6268',
  minor: '#4b4e54',
  rail: '#45484e',
  boundary: '#6a6d73',
  label: '#d1d1d6',
  roadLabel: '#aeaeb2',
  waterLabel: '#8aa4c0',
  halo: '#1c1c1e',
};

function darkFill(l: LayerSpecification): string {
  const sl = sourceLayer(l);
  if (sl === 'water') return DARK.water;
  if (sl === 'park' || l.id.includes('wood') || l.id.includes('grass') || l.id.includes('wetland')) return DARK.green;
  if (l.id.includes('sand')) return DARK.sand;
  if (sl === 'building') return DARK.building;
  if (l.id === 'landuse_residential') return DARK.land;
  return DARK.landAlt;
}

function darkLine(l: LayerSpecification): string {
  const sl = sourceLayer(l);
  const id = l.id;
  if (sl === 'waterway') return DARK.water;
  if (sl === 'boundary') return DARK.boundary;
  if (id.includes('casing')) return DARK.casing;
  if (id.includes('rail')) return DARK.rail;
  if (id.includes('motorway')) return DARK.motorway;
  if (id.includes('trunk') || id.includes('primary') || id.includes('secondary') || id.includes('tertiary')) return DARK.major;
  return DARK.minor;
}

/** Açık stili koyu temaya çevirir (katmanlar ve ayrıntı aynı kalır, yalnızca renkler değişir). */
function dark(style: StyleSpecification): StyleSpecification {
  const layers = style.layers
    .filter((l) => l.id !== 'park_outline')
    .map((l): LayerSpecification => {
      switch (l.type) {
        case 'background':
          return { ...l, paint: { ...l.paint, 'background-color': DARK.land } };
        case 'raster': // dünya kabartma altlığı: koyuda soluk kalsın
          return { ...l, paint: { ...l.paint, 'raster-opacity': 0.15 } };
        case 'fill':
          if (l.paint?.['fill-pattern']) return { ...l, paint: { ...l.paint, 'fill-opacity': 0.15 } };
          return {
            ...l,
            paint: { ...l.paint, 'fill-color': darkFill(l), ...(sourceLayer(l) === 'building' ? { 'fill-outline-color': DARK.buildingEdge } : {}) },
          };
        case 'fill-extrusion':
          return { ...l, paint: { ...l.paint, 'fill-extrusion-color': DARK.building } };
        case 'line':
          if (l.paint?.['line-pattern']) return { ...l, paint: { ...l.paint, 'line-opacity': 0.3 } };
          return { ...l, paint: { ...l.paint, 'line-color': darkLine(l) } };
        case 'symbol': {
          if (!l.layout?.['text-field'] || l.id.includes('shield')) return l;
          const sl = sourceLayer(l);
          const color = sl === 'water_name' || sl === 'waterway' ? DARK.waterLabel : sl === 'transportation_name' ? DARK.roadLabel : DARK.label;
          return { ...l, paint: { ...l.paint, 'text-color': color, 'text-halo-color': DARK.halo, 'text-halo-width': 1.2 } };
        }
        default:
          return l;
      }
    });
  return { ...style, layers };
}

/** İndirilen OpenFreeMap stilini seçilen görünüme göre hazırlar. */
export function prepareStyle(style: StyleSpecification, variant: Variant): StyleSpecification {
  const base = withoutPois(style);
  return variant === 'dark' ? dark(base) : base;
}

let pending: Promise<StyleSpecification | null> | null = null;

function fetchStyle(): Promise<StyleSpecification | null> {
  if (!pending) {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const req = fetch(STYLE_URL)
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
      .catch(() => null);
    pending = Promise.race([req, timeout]).then((s) => {
      if (!s) pending = null; // sonra tekrar denensin
      return s;
    });
  }
  return pending;
}

// Hazırlanmış stiller aynı nesne olarak saklanır; aynı nesne haritanın stili yeniden yüklemesine yol açmaz.
const built = new Map<Variant, StyleSpecification>();

/**
 * Haritaya verilecek stil (hazır olana kadar null). Stil indirilemezse hazır stilin adresi verilir;
 * MapLibre kendi önbelleğinden açar (POI'ler o durumda görünür, harita yine çalışır).
 */
export function useMapStyle(variant: Variant): StyleSpecification | string | null {
  const [result, setResult] = useState<{ variant: Variant; style: StyleSpecification | string } | null>(null);

  useEffect(() => {
    if (built.has(variant)) return;
    let alive = true;
    fetchStyle().then((s) => {
      if (s) built.set(variant, prepareStyle(s, variant));
      // Başarısızlık önbelleğe yazılmaz; bir sonraki açılışta yeniden denenir.
      if (alive) setResult({ variant, style: built.get(variant) ?? FALLBACK_URLS[variant] });
    });
    return () => {
      alive = false;
    };
  }, [variant]);

  return built.get(variant) ?? (result?.variant === variant ? result.style : null);
}
