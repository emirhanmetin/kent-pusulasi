import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Area, LayerMeta } from '@/lib/api';
import type { Point } from '@/lib/geo';
import { checkNearby } from '@/lib/nearbyAlerts';
import { alertsStore } from '@/lib/persistent';

const EVERY = 5 * 60 * 1000;
const MIN_GAP = 60 * 1000; // uygulamaya art arda dönüşlerde sunucuyu yormamak için

/** Ayar açıksa, uygulama açıkken (ve öne her gelişinde) yakındaki yeni kesintileri kontrol eder. */
export function useNearbyAlerts(location: Point, area: Area | null, metas: LayerMeta[]) {
  const [{ local, radius }] = alertsStore.use();
  const lastRun = useRef(0);
  const layers = metas.filter((m) => m.outage).map((m) => m.id).join(',');
  const mahalle = area?.mahalle ?? null;
  const ilce = area?.ilce ?? null;

  useEffect(() => {
    if (!local || !layers) return;
    lastRun.current = 0; // ayar, konum ya da yarıçap değişince hemen kontrol et
    const run = () => {
      if (AppState.currentState === 'background' || Date.now() - lastRun.current < MIN_GAP) return;
      lastRun.current = Date.now();
      checkNearby({ lat: location.lat, lng: location.lng }, { ilce, mahalle }, layers.split(',')).catch(() => {
        /* internet yoksa bir sonraki denemede */
      });
    };
    run();
    const timer = setInterval(run, EVERY);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [local, radius, layers, location.lat, location.lng, ilce, mahalle]);
}
