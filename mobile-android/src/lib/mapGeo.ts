// MapLibre yardımcıları: bölge (Region) ↔ görünüm, metre cinsinden daireler, sınır kutusu.
import type { LngLatBounds } from '@maplibre/maplibre-react-native';

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };

/** Haritanın görünen sınırlarından (batı, güney, doğu, kuzey) bölge. */
export function regionFromBounds([west, south, east, north]: LngLatBounds): Region {
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.abs(north - south),
    longitudeDelta: Math.abs(east - west),
  };
}

/** Boylam genişliğine (derece) karşılık gelen yaklaşık zoom düzeyi. */
export const zoomForDelta = (delta: number) => Math.max(2, Math.min(18, Math.log2(360 / delta)));

export function boundsOf(points: LatLng[]): LngLatBounds {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** Merkez ve yarıçaptan (metre) 48 köşeli daire çokgeni (GeoJSON halkası). */
export function circleRing(lat: number, lng: number, radius: number, steps = 48): [number, number][] {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}
