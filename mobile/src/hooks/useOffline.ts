// Çevrimdışı hazırlık: toplanma alanı paketini günde bir indirir ve en yakın alana yürüme rotasını saklar.
import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';
import { haversine, type Point } from '@/lib/geo';
import {
  nearestOffline,
  OFFLINE_MAX_AGE,
  ROUTE_REUSE_RADIUS,
  type OfflinePack,
  type OfflineRow,
  type SavedRoute,
} from '@/lib/offline';

import { useStored } from './useStored';

export function useOffline(location: Point & { source: string }) {
  const [pack, setPack, packReady] = useStored<OfflinePack | null>('cevrimdisi-toplanma', null);
  const [savedRoute, setSavedRoute, routeReady] = useStored<SavedRoute | null>('cevrimdisi-rota', null);
  const routeBusy = useRef(false);

  // Paket yoksa ya da bir günden eskiyse indir (internet yoksa sessizce vazgeç, eldeki kalır).
  useEffect(() => {
    if (!packReady || (pack && Date.now() - pack.savedAt < OFFLINE_MAX_AGE)) return;
    let alive = true;
    api
      .offlinePack()
      .then((p) => alive && setPack({ savedAt: Date.now(), version: p.surum, items: p.toplanma as OfflineRow[] }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [packReady, pack, setPack]);

  // Gerçek konum biliniyorsa en yakın toplanma alanına yürüme rotasını önceden kaydet.
  useEffect(() => {
    if (!pack || !routeReady || routeBusy.current) return;
    if (location.source !== 'gps' && location.source !== 'manual') return;
    const nearest = nearestOffline(pack, location);
    if (!nearest) return;
    const fresh =
      savedRoute &&
      savedRoute.toId === nearest.row[0] &&
      haversine(savedRoute.from, location) < ROUTE_REUSE_RADIUS / 2 &&
      Date.now() - savedRoute.savedAt < 7 * OFFLINE_MAX_AGE;
    if (fresh) return;
    routeBusy.current = true;
    api
      .route(location, { lat: nearest.row[2], lng: nearest.row[3] }, 'yuruyus')
      .then((r) =>
        setSavedRoute({
          from: { lat: location.lat, lng: location.lng },
          toId: nearest.row[0],
          coords: r.koordinatlar,
          text: `${r.mesafeMetin} yol · ~${r.sureMetin} yürüyerek`,
          savedAt: Date.now(),
        }),
      )
      .catch(() => {})
      .finally(() => {
        routeBusy.current = false;
      });
  }, [pack, routeReady, savedRoute, setSavedRoute, location]);

  /** İnternet yokken seçilen alan için kayıtlı rota (başlangıç noktası yakınsa). */
  const routeFor = (itemId: string, from: Point): SavedRoute | null =>
    savedRoute && savedRoute.toId === itemId && haversine(savedRoute.from, from) < ROUTE_REUSE_RADIUS ? savedRoute : null;

  return { pack, routeFor };
}
