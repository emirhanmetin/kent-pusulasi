// Yerel hatırlatıcılar (telefonun kendi takvimiyle; sunucu gerekmez, Expo Go'da da çalışır).
import * as Notifications from 'expo-notifications';

import type { Item } from '@/lib/api';
import { remindersStore } from '@/lib/persistent';

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return asked.granted;
}

/** Sunucudaki gün numarası (0 = Pazartesi … 6 = Pazar) -> iOS/Expo haftalık tetikleyici (1 = Pazar … 7 = Cumartesi). */
export const toTriggerWeekday = (day: number) => ((day + 1) % 7) + 1;

export const dayNames = (days: number[]) => days.map((d) => DAY_NAMES[d]).join(', ');

/** Pazarın kurulduğu her gün sabah 08:00'de hatırlat. */
export async function addMarketReminder(item: Item): Promise<boolean> {
  const days = item.days ?? [];
  if (!days.length || !(await ensureNotificationPermission())) return false;
  const ids: string[] = [];
  for (const d of days) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Bugün pazar kuruluyor', body: `${item.name}${item.sub ? ` · ${item.sub}` : ''}` },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: toTriggerWeekday(d), hour: 8, minute: 0 },
      }),
    );
  }
  remindersStore.set((r) => ({ ...r, pazar: { ...r.pazar, [item.id]: { name: item.name, days, ids } } }));
  return true;
}

export async function removeMarketReminder(itemId: string) {
  const entry = remindersStore.get().pazar[itemId];
  if (entry) await Promise.all(entry.ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  remindersStore.set((r) => {
    const pazar = { ...r.pazar };
    delete pazar[itemId];
    return { ...r, pazar };
  });
}

/** Her ayın 1'inde 19:00: deprem çantası ve buluşma noktası kontrolü. */
export async function setMonthlyPrep(on: boolean): Promise<boolean> {
  const current = remindersStore.get().monthlyPrep;
  if (current) await Notifications.cancelScheduledNotificationAsync(current).catch(() => {});
  if (!on) {
    remindersStore.set((r) => ({ ...r, monthlyPrep: null }));
    return true;
  }
  if (!(await ensureNotificationPermission())) return false;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Deprem hazırlık kontrolü',
      body: 'Deprem çantanızı, suyunuzu ve aile buluşma noktanızı gözden geçirme zamanı.',
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 19, minute: 0 },
  });
  remindersStore.set((r) => ({ ...r, monthlyPrep: id }));
  return true;
}
