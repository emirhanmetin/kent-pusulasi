// Anlık (uzak) bildirimler: Expo bildirim anahtarını alır, sunucudaki aboneliği yönetir.
// Not: Expo SDK 53'ten beri uzak bildirimler Expo Go'da çalışmaz; Google Play (ya da imzalı APK) sürümü gerekir.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { api } from '@/lib/api';
import { alertsStore, mahallemStore, pushStore, type PushSettings } from '@/lib/persistent';
import { ensureNotificationPermission } from '@/lib/reminders';

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export class PushUnavailable extends Error {}

const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Bu derlemede anlık bildirim kurulu mu (Firebase + Expo proje kimliği). Değilse ilgili ayarlar gizlenir. */
export const pushAvailable = !isExpoGo && !!projectId;

async function getPushToken(): Promise<string> {
  if (isExpoGo) throw new PushUnavailable('Anlık bildirimler Expo Go’da çalışmaz; Google Play sürümünde açılır.');
  if (!Device.isDevice) throw new PushUnavailable('Anlık bildirimler yalnızca gerçek bir telefonda çalışır.');
  if (!(await ensureNotificationPermission())) {
    throw new PushUnavailable('Bildirim izni verilmedi. Ayarlar › Uygulamalar › Kent Pusulası › Bildirimler’den açabilirsiniz.');
  }
  if (!projectId) throw new PushUnavailable('Anlık bildirimler bu sürümde henüz etkin değil. Hatırlatıcılar ve “yakınımdaki kesintiler” uyarısı çalışır.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Aboneliği açar ya da (mahalle/tür değişince) günceller. */
export async function enablePush(types: PushSettings['types']): Promise<void> {
  const mahallem = mahallemStore.get();
  if (types.some((t) => t !== 'deprem') && !mahallem) {
    throw new PushUnavailable('Kesinti ve hava bildirimleri için önce “Mahallem”i seçin.');
  }
  const token = pushStore.get().token ?? (await getPushToken());
  await api.subscribe({
    token,
    ilce: mahallem?.ilce ?? null,
    mahalle: mahallem?.mahalle ?? null,
    turler: types,
    yaricap: alertsStore.get().radius,
  });
  pushStore.set({ enabled: true, types, token });
}

/** Aboneliği ve sunucudaki kaydı siler. */
export async function disablePush(): Promise<void> {
  const { token, types } = pushStore.get();
  if (token) await api.unsubscribe(token).catch(() => {});
  pushStore.set({ enabled: false, types, token: null });
}
