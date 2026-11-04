// Ekranlar arasında paylaşılan, telefonda kalıcı küçük depolar (useSyncExternalStore ile).
// Bir ekranda yapılan değişiklik (ör. bildirim ayarlarında "Mahallem") diğer ekranlara anında yansır.
import { useSyncExternalStore } from 'react';

import type { Area, Item } from '@/lib/api';
import { readJson, writeJson } from '@/lib/storage';

export function persistent<T>(name: string, initial: T) {
  let value = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  readJson<T>(name, initial).then((v) => {
    value = v;
    loaded = true;
    emit();
  });

  const set = (next: T | ((prev: T) => T)) => {
    value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
    try {
      writeJson(name, value);
    } catch {
      /* depolama hatası: bellekte yine de güncel */
    }
    emit();
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  const getValue = () => value;
  const getLoaded = () => loaded;

  function use() {
    const v = useSyncExternalStore(subscribe, getValue);
    const ready = useSyncExternalStore(subscribe, getLoaded);
    return [v, set, ready] as const;
  }
  return { use, set, get: getValue };
}

/** Yalnızca bellekte tutulan paylaşımlı değer (telefona yazılmaz). */
export function memory<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    value = next;
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  const getValue = () => value;
  const use = () => [useSyncExternalStore(subscribe, getValue), set] as const;
  return { use, set, get: getValue };
}

/* ---------- Uygulamanın kalıcı kullanıcı verileri (yalnızca telefonda) ---------- */

export type MeetingPoint = { id: string; name: string; sub: string; lat: number; lng: number };
export type Mahallem = { ilce: string; mahalle: string };
export type Favorite = { layerId: string; item: Item; savedAt: number };
export type Reminders = {
  pazar: Record<string, { name: string; days: number[]; ids: string[] }>;
  monthlyPrep: string | null; // aylık deprem hazırlık hatırlatmasının bildirim kimliği
};
export type PushType = 'su' | 'elektrik' | 'deprem' | 'hava';
export type PushSettings = { enabled: boolean; types: PushType[]; token: string | null };
// radius: yakındaki kesintiler için km (0 = yalnızca mahallem); local: uygulama açıkken telefonda kontrol
export type AlertSettings = { radius: number; local: boolean; seen: string[] };

export const meetingStore = persistent<MeetingPoint | null>('bulusma-noktasi', null);
export const mahallemStore = persistent<Mahallem | null>('mahallem', null);
export const favoritesStore = persistent<Favorite[]>('favoriler', []);
export const remindersStore = persistent<Reminders>('hatirlaticilar', { pazar: {}, monthlyPrep: null });
export const pushStore = persistent<PushSettings>('anlik-bildirim', { enabled: false, types: ['su', 'elektrik', 'deprem'], token: null });
export const alertsStore = persistent<AlertSettings>('yakin-uyarilar', { radius: 1, local: false, seen: [] });

/** Konumdan tahmin edilen mahalle (bildirim ayarlarında "Bulunduğum yer" önerisi için; kaydedilmez). */
export const areaStore = memory<(Area & { lat: number; lng: number }) | null>(null);
