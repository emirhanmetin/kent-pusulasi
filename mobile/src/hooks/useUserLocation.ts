// Konum: 1) iPhone GPS'i  2) olmazsa Python servisinden IP'ye göre yaklaşık konum  3) olmazsa Konak.
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

export type UserLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  source: 'gps' | 'ip' | 'manual' | 'default';
};

export const DEFAULT_LOCATION: UserLocation = { lat: 38.4189, lng: 27.1287, source: 'default' }; // Konak Meydanı

const inIzmir = (lat: number, lng: number) => lat >= 37.8 && lat <= 39.45 && lng >= 26.1 && lng <= 28.55;

type Resolved = { location: UserLocation; message: string | null };

/** Konumu belirler; state'e dokunmaz (sonucu hook uygular). */
async function resolveLocation(): Promise<Resolved> {
  let reason = 'Konum alınamadı.';
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === 'granted') {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude, accuracy } = p.coords;
      if (inIzmir(latitude, longitude)) {
        return { location: { lat: latitude, lng: longitude, accuracy: accuracy ?? undefined, source: 'gps' }, message: null };
      }
      reason = 'Konumunuz İzmir dışında görünüyor.';
    } else {
      reason = 'Konum izni verilmedi (Ayarlar › Gizlilik › Konum Servisleri).';
    }
  } catch {
    reason = 'Cihaz konumu belirlenemedi.';
  }

  try {
    const ip = await api.ipLocation();
    if (ip.izmirde) {
      return {
        location: { lat: ip.lat, lng: ip.lng, accuracy: ip.accuracy, source: 'ip' },
        message: `${reason} İnternet bağlantınıza göre yaklaşık konum kullanılıyor. Haritaya uzun basarak konumu seçebilirsiniz.`,
      };
    }
  } catch {
    /* IP konumu da yoksa varsayılana düş */
  }
  return { location: DEFAULT_LOCATION, message: `${reason} Konak varsayıldı. Haritaya uzun basarak konumunuzu seçebilirsiniz.` };
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation>(DEFAULT_LOCATION);
  const [locating, setLocating] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const apply = useCallback((r: Resolved) => {
    setLocation(r.location);
    setMessage(r.message);
    setLocating(false);
  }, []);

  /** Kullanıcı "Konumumu bul"a basınca. */
  const locate = useCallback(async () => {
    setLocating(true);
    apply(await resolveLocation());
  }, [apply]);

  const setManual = useCallback((lat: number, lng: number) => {
    setLocation({ lat, lng, source: 'manual' });
    setMessage(null);
  }, []);

  useEffect(() => {
    let alive = true;
    resolveLocation().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply]);

  return { location, locating, message, locate, setManual };
}
