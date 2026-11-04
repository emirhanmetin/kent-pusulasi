// Çevrimdışı mod: internet yokken toplanma alanları telefondaki kayıttan, telefonun GPS'iyle sıralanır.
import type { Item, LayerMeta, LayerResponse } from '@/lib/api';
import { fmtDist, haversine, walkMinutes, type Point } from '@/lib/geo';

/** Sunucudaki /api/cevrimdisi yanıtının kısa biçimi: [id, ad, enlem, boylam, mahalle, ilçe] */
export type OfflineRow = [string, string, number, number, string, string];
export type OfflinePack = { savedAt: number; version: number; items: OfflineRow[] };

/** En yakın toplanma alanına kaydedilmiş yürüme rotası (internet yokken çizilir). */
export type SavedRoute = { from: Point; toId: string; coords: [number, number][]; text: string; savedAt: number };

export const OFFLINE_MAX_AGE = 24 * 3600 * 1000; // paket günde bir yenilenir
export const ROUTE_REUSE_RADIUS = 400; // kayıtlı rota, başlangıcına bu kadar yakınken kullanılır (m)
export const TOPLANMA_COLOR = '#34c759';

// Sunucuya hiç ulaşılamazsa menüde yine de Toplanma görünsün diye yerel tanım
export const OFFLINE_TOPLANMA_META: LayerMeta = {
  id: 'toplanma',
  group: 'Sağlık ve afet',
  title: 'Toplanma Alanları',
  navTitle: 'Toplanma Alanları',
  icon: ['Tent'],
  color: TOPLANMA_COLOR,
  intro: 'İnternet yok: telefonunuza kayıtlı liste gösteriliyor.',
  cluster: true,
  slow: false,
  noMap: false,
  outage: false,
  areaCircles: false,
  search: true,
  searchPlaceholder: 'Ad, mahalle veya ilçe ara',
  emptyText: 'Kayıtlı toplanma alanı yok.',
  errorText: '',
  errorLink: null,
  directions: 'walking',
  routing: false,
  defaultMode: 'yuruyus',
};

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

export function nearestOffline(pack: OfflinePack, from: Point): { row: OfflineRow; dist: number } | null {
  let best: { row: OfflineRow; dist: number } | null = null;
  for (const row of pack.items) {
    const d = haversine(from, { lat: row[2], lng: row[3] });
    if (!best || d < best.dist) best = { row, dist: d };
  }
  return best;
}

/** Kayıtlı paketten, sunucu yanıtıyla aynı biçimde bir liste üretir (kuş uçuşu, telefonda hesaplanır). */
export function offlineToplanma(pack: OfflinePack, from: Point, query = ''): LayerResponse {
  const q = query.trim().toLocaleLowerCase('tr-TR');
  const items: Item[] = pack.items
    .filter((r) => !q || `${r[1]} ${r[4]} ${r[5]}`.toLocaleLowerCase('tr-TR').includes(q))
    .map(([id, name, lat, lng, mahalle, ilce]) => {
      const d = haversine(from, { lat, lng });
      return {
        id,
        name,
        lat,
        lng,
        sub: [mahalle, ilce].filter(Boolean).join(', '),
        color: TOPLANMA_COLOR,
        badge: null,
        details: [
          ['Mahalle', [mahalle, ilce].filter(Boolean).join(', ')],
          ['Uzaklık', `${fmtDist(d)} kuş uçuşu · ~${walkMinutes(d)} dk yürüyerek`],
          ['Kaynak', `Telefonunuzdaki kayıt (${fmtDay(pack.savedAt)})`],
        ],
        phone: null,
        dist: Math.round(d),
        distText: fmtDist(d),
        distKind: 'kus',
        mode: 'yuruyus',
      } satisfies Item;
    })
    .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));

  return {
    mesafe: { tur: 'kus', yolSayisi: 0, adaySayisi: 0, hata: null, mod: 'yuruyus' },
    durum: {
      guncellendi: pack.savedAt / 1000,
      guncellendiMetin: fmtDay(pack.savedAt),
      eski: true,
      hata: 'çevrimdışı',
      damga: `Çevrimdışı · ${pack.items.length.toLocaleString('tr-TR')} alan · ${fmtDay(pack.savedAt)} tarihli kayıt`,
    },
    filtreler: [],
    filtre: null,
    toplam: pack.items.length,
    items,
  };
}
