// Konum: 1) telefonun GPS'i  2) olmazsa Python servisinden IP'ye göre yaklaşık konum  3) olmazsa Konak.
// GPS iki kaynaktan dinlenir: expo-location (Google konum servisi) ve MapLibre'nin konum modülü (telefonun kendi
// GPS'i; Google servisleri olmayan Huawei telefonlarda da çalışır). Hangisi önce bulursa o kullanılır.
import { LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

export type UserLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  source: 'gps' | 'ip' | 'manual' | 'default';
};

export const DEFAULT_LOCATION: UserLocation = { lat: 38.4189, lng: 27.1287, source: 'default' }; // Konak Meydanı

const inIzmir = (lat: number, lng: number) => lat >= 37.8 && lat <= 39.45 && lng >= 26.1 && lng <= 28.55;

type Fix = { lat: number; lng: number; accuracy?: number };
type Resolved = { location: UserLocation; message: string | null; granted: boolean };

const GPS_TIMEOUT_MS = 10_000;
const RECENT_FIX_MS = 2 * 60_000; // bu kadar yeni "son bilinen konum" varsa beklemeden kullanılır
const LAST_KNOWN_MAX_AGE_MS = 30 * 60_000; // GPS hiç yanıt vermezse en fazla bu kadar eski son konum
const LATE_GPS_MS = 3 * 60_000; // yedek konum kullanılırken GPS'i bu süre dinlemeye devam et

const fromExpo = (p: Location.LocationObject | null): Fix | null =>
  p ? { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? undefined } : null;
const fromMapLibre = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });

/** MapLibre konum modülünden ilk konum (telefonun kendi GPS'i). Dinleyici kaldırılınca durur. */
function mapLibreFix(timeoutMs: number): Promise<Fix | null> {
  return new Promise((resolve) => {
    const done = (fix: Fix | null) => {
      clearTimeout(timer);
      LocationManager.removeListener(onUpdate);
      resolve(fix);
    };
    const onUpdate = (p: GeolocationPosition) => done(fromMapLibre(p));
    const timer = setTimeout(() => done(null), timeoutMs);
    LocationManager.addListener(onUpdate);
  });
}

/** İki kaynaktan hangisi önce taze konum verirse; süre dolarsa son bilinen konum. */
async function currentFix(): Promise<Fix | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS));
  const expo = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then(fromExpo)
    .catch(() => null);
  // Biri hata verip null dönerse diğeri beklenir (Promise.any benzeri)
  const first = new Promise<Fix | null>((resolve) => {
    let pending = 2;
    const settle = (f: Fix | null) => (f ? resolve(f) : --pending === 0 && resolve(null));
    expo.then(settle);
    mapLibreFix(GPS_TIMEOUT_MS).then(settle);
  });
  return (
    (await Promise.race([first, timeout])) ??
    fromExpo(await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null))
  );
}

/** Konumu belirler; state'e dokunmaz (sonucu hook uygular). */
async function resolveLocation(): Promise<Resolved> {
  let reason = 'Konum alınamadı.';
  let granted = false;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    granted = perm.status === 'granted';
    if (granted) {
      // Yakın zamanda bulunmuş konum varsa açılışta beklemeden onu kullan.
      const recent = fromExpo(await Location.getLastKnownPositionAsync({ maxAge: RECENT_FIX_MS }).catch(() => null));
      const p = recent && inIzmir(recent.lat, recent.lng) ? recent : await currentFix();
      if (!p) {
        reason = 'Cihaz konumu henüz bulunamadı.';
      } else if (inIzmir(p.lat, p.lng)) {
        return { location: { ...p, source: 'gps' }, message: null, granted };
      } else {
        reason = 'Konumunuz İzmir dışında görünüyor.';
      }
    } else {
      reason = 'Konum izni verilmedi (Ayarlar › Uygulamalar › Kent Pusulası › İzinler › Konum).';
    }
  } catch {
    reason = 'Cihaz konumu henüz bulunamadı.';
  }

  try {
    const ip = await api.ipLocation();
    if (ip.izmirde) {
      return {
        location: { lat: ip.lat, lng: ip.lng, accuracy: ip.accuracy, source: 'ip' },
        message: `${reason} İnternet bağlantınıza göre yaklaşık konum kullanılıyor; GPS bulunca kendiliğinden düzelir.`,
        granted,
      };
    }
  } catch {
    /* IP konumu da yoksa varsayılana düş */
  }
  return {
    location: DEFAULT_LOCATION,
    message: `${reason} Şimdilik Konak gösteriliyor; GPS bulunca kendiliğinden düzelir. Haritaya uzun basarak da konum seçebilirsiniz.`,
    granted,
  };
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation>(DEFAULT_LOCATION);
  const [locating, setLocating] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const manual = useRef(false);
  const stopLate = useRef<(() => void) | null>(null);

  // Yedek konum (IP / Konak) kullanılırken GPS geç bulursa ona geçilir; kullanıcı elle konum seçtiyse dokunulmaz.
  const watchLateGps = useCallback(() => {
    stopLate.current?.();
    let stopped = false;
    let expoSub: Location.LocationSubscription | null = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      LocationManager.removeListener(onMapLibre);
      expoSub?.remove();
      stopLate.current = null;
    };
    const accept = (f: Fix) => {
      if (stopped || manual.current || !inIzmir(f.lat, f.lng)) return;
      stop();
      setLocation({ ...f, source: 'gps' });
      setMessage(null);
    };
    const onMapLibre = (p: GeolocationPosition) => accept(fromMapLibre(p));
    const timer = setTimeout(stop, LATE_GPS_MS);
    LocationManager.addListener(onMapLibre);
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 3000 }, (p) => {
      const f = fromExpo(p);
      if (f) accept(f);
    })
      .then((sub) => (stopped ? sub.remove() : (expoSub = sub)))
      .catch(() => {});
    stopLate.current = stop;
  }, []);

  const apply = useCallback(
    (r: Resolved) => {
      setLocation(r.location);
      setMessage(r.message);
      setLocating(false);
      if (r.location.source !== 'gps' && r.granted) watchLateGps();
    },
    [watchLateGps],
  );

  /** Kullanıcı "Konumumu bul"a basınca. Bulunan konumu döndürür (harita oraya gitsin diye). */
  const locate = useCallback(async (): Promise<UserLocation> => {
    manual.current = false;
    setLocating(true);
    const r = await resolveLocation();
    apply(r);
    return r.location;
  }, [apply]);

  const setManual = useCallback((lat: number, lng: number) => {
    manual.current = true;
    stopLate.current?.();
    setLocation({ lat, lng, source: 'manual' });
    setMessage(null);
  }, []);

  useEffect(() => {
    let alive = true;
    resolveLocation().then((r) => alive && apply(r));
    return () => {
      alive = false;
      stopLate.current?.();
    };
  }, [apply]);

  return { location, locating, message, locate, setManual };
}
