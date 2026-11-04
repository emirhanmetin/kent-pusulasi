// Yakınımdaki kesintiler: uygulama açıkken telefonun kendisi kontrol eder ve yerel bildirim gösterir.
// Sunucuya kayıt gerekmez; Expo Go'da da çalışır. Uygulama kapalıyken haber almak için anlık bildirimler
// (sunucu, mahalleye ve seçilen yarıçapa göre gönderir) kullanılır.
import * as Notifications from 'expo-notifications';

import { api, type Item } from '@/lib/api';
import type { Point } from '@/lib/geo';
import { alertsStore } from '@/lib/persistent';

export const RADII = [0, 1, 3, 5] as const;
export const radiusLabel = (r: number) => (r === 0 ? 'Mahallem' : `${r} km`);

const LAYERS = [
  { id: 'su', title: 'su kesintisi' },
  { id: 'elektrik', title: 'elektrik kesintisi' },
] as const;
const SEEN_KEEP = 300;
const NEAR_MIN_M = 500;

/** 'Refik Şevket İnce Mahallesi' -> 'refikşevketince' (sunucudaki areas.norm ile aynı) */
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\b(mahallesi|mahalle|mah)\b\.?/g, ' ')
    .replace(/[^a-zçğıöşü0-9]/g, '');

function inMyNeighbourhood(it: Item, area: { ilce: string | null; mahalle: string | null } | null) {
  if (!area?.mahalle || norm(it.ilce) !== norm(area.ilce)) return false;
  return (it.mahalle ?? '').split(/[,;]/).some((m) => norm(m) === norm(area.mahalle));
}

/** Konuma (ve tahmini mahalleye) göre yeni kesintileri bulur, varsa tek bir bildirimde gösterir. */
export async function checkNearby(
  location: Point,
  area: { ilce: string | null; mahalle: string | null } | null,
  layers: string[],
): Promise<number> {
  const { radius, seen } = alertsStore.get();
  if (!(await Notifications.getPermissionsAsync()).granted) return 0;

  const found: { key: string; layer: (typeof LAYERS)[number]; item: Item; mine: boolean }[] = [];
  for (const layer of LAYERS) {
    if (!layers.includes(layer.id)) continue;
    const res = await api.layer(layer.id, { lat: location.lat, lng: location.lng });
    for (const it of res.items) {
      const mine = inMyNeighbourhood(it, area);
      // Tahmini mahalle bazen komşu mahalle çıkar; etkilenen mahallenin merkezine 500 m'den yakınsa da sayılır.
      const near = it.dist != null && it.dist <= Math.max(radius * 1000, NEAR_MIN_M);
      if (mine || near) found.push({ key: `${layer.id}:${it.id}`, layer, item: it, mine });
    }
  }
  const fresh = found.filter((f) => !seen.includes(f.key));
  if (!fresh.length) return 0;

  const [first] = fresh;
  const content =
    fresh.length === 1
      ? {
          title: `${first.mine ? 'Mahallenizde' : 'Yakınınızda'} ${first.layer.title} (${first.item.kind ?? 'duyuru'})`,
          body: [
            `${first.item.ilce} · ${first.item.mahalle}`,
            !first.mine && first.item.distText ? `~${first.item.distText}` : null,
            first.item.duration,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : {
          title: `Yakınınızda ${fresh.length} yeni kesinti`,
          body: fresh
            .slice(0, 4)
            .map((f) => `${f.layer.id === 'su' ? 'Su' : 'Elektrik'}: ${f.item.mahalle}`)
            .join(' • '),
        };
  await Notifications.scheduleNotificationAsync({ content: { ...content, data: { olaylar: fresh.map((f) => f.key) } }, trigger: null });
  alertsStore.set((s) => ({ ...s, seen: [...fresh.map((f) => f.key), ...s.seen].slice(0, SEEN_KEEP) }));
  return fresh.length;
}
