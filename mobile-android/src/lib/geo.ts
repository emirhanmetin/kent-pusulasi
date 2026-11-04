// Cihaz üzerinde mesafe hesabı: internet yokken (çevrimdışı mod) ve buluşma noktası için.

export type Point = { lat: number; lng: number };

/** İki nokta arası kuş uçuşu mesafe (metre). */
export function haversine(a: Point, b: Point): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} km`;
}

/** Kuş uçuşundan yaklaşık yürüme süresi: yol kıvrımı için ×1,3, 4,8 km/sa. */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
