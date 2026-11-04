// Ana ekran: tam ekran harita (MapLibre + OpenFreeMap) + alttan sürüklenen sayfa (kategoriler, liste, yer kartı).
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MapLibreMap,
  UserLocation,
  type CameraRef,
  type FilterSpecification,
} from '@maplibre/maplibre-react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryBar, type Category } from '@/components/CategoryBar';
import { MEETING_COLOR, MeetingCard, shareMeetingPoint } from '@/components/MeetingCard';
import { ModeToggle } from '@/components/ModeToggle';
import { PlaceCard } from '@/components/PlaceCard';
import { NearbyRow, OutageRow, PlaceRow, PriceRow, Separator } from '@/components/PlaceRow';
import { useDebounced } from '@/hooks/useDebounced';
import { useOffline } from '@/hooks/useOffline';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { useUserLocation } from '@/hooks/useUserLocation';
import { api, type Item, type LayerMeta, type LayerResponse, type NearbyCard, type NearbyResult, type TravelMode } from '@/lib/api';
import { OVERVIEW_COLOR, OVERVIEW_ID, SYM, shortTitle, symbolFor } from '@/lib/categories';
import { fmtDist, haversine } from '@/lib/geo';
import { OFFLINE_TOPLANMA_META, offlineToplanma } from '@/lib/offline';
import { areaStore, favoritesStore, mahallemStore, meetingStore, pushStore, remindersStore } from '@/lib/persistent';
import { enablePush } from '@/lib/push';
import { addMarketReminder, dayNames, removeMarketReminder } from '@/lib/reminders';
import { MAP_ICONS } from '@/lib/mapIcons';
import { boundsOf, circleRing, regionFromBounds, zoomForDelta, type LatLng, type Region } from '@/lib/mapGeo';
import { useMapStyle } from '@/lib/mapStyle';
import { useTheme } from '@/lib/theme';

const SNAPS = [0.2, 0.5, 0.9];
const SHEET_CHECKS_MS = [300, 1000, 2500, 5000]; // açılışta alt sayfanın ekranda olup olmadığına bakılan anlar
const INITIAL_REGION: Region = { latitude: 38.4189, longitude: 27.1287, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const MAX_MARKERS = 150; // performans: yalnızca görünen alandaki en yakın kayıtlar çizilir
const AREA_RADIUS = 450; // metre: sunucu mahallenin yaklaşık yarıçapını vermezse kesinti dairesi
const OVERVIEW_NEAR_M = 2500; // Yakınımda: haritada bu kadar yakındaki kayıtlar görünür, uzaktakiler (ör. deprem) uzaklaştırmaz
const MIN_HALF_SPAN = 0.006; // derece (~650 m): konumun çevresinde en az bu kadar alan görünsün
const USER_FOCUS_HOLD_MS = 3000; // "Konumumu bul" sonrası otomatik odaklama bu süre beklesin
const NEAR_OUTAGE_M = 5000;
const SMALL_SHAPE_M = 150; // bu yarıçaptan küçük kesinti alanı çokgen yerine daire olarak çizilir // kesinti menüsü açılınca haritada gösterilecek çevre (konumunuza uzaklık)
const USER_ZOOM_DELTA = 0.008; // "Konumumu bul" yakınlığı: ~800 m genişlik, sokak adları okunur
const OUTAGE_LEGEND = [
  { label: 'Arıza', color: '#ff9500' },
  { label: 'Planlı', color: '#5856d6' },
];
const areaPoints = (it: Item): LatLng[] => (it.areas ?? []).map((a) => ({ latitude: a.lat, longitude: a.lng }));
const PAGE = 60;
// İşaret boyutları iOS'takiyle aynı (çap = 2 × (r + kenar)): küçük 26, büyük 34, seçili balon 44
const PIN = {
  small: { r: 11, sw: 2, is: 0.15 },
  large: { r: 15, sw: 2, is: 0.2 },
  selected: { r: 19, sw: 3, is: 0.26 },
  dot: { r: 7, sw: 3, is: 0 },
};
// Seçili balon, altındaki 9 birimlik ucun üstünde durur (iOS'taki gibi işaretin gösterdiği nokta ucun ucudur).
const BALLOON_LIFT = PIN.selected.r + PIN.selected.sw + 8;
const IS_SELECTED: FilterSpecification = ['==', ['get', 'sel'], true];
const NOT_SELECTED: FilterSpecification = ['!=', ['get', 'sel'], true];
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type Selection = { item: Item; layerId: string };
type CardState = NearbyResult | { error: string };
type LayerResult = { key: string; category: string; data?: LayerResponse; error?: string };
type OverviewState = { key: string; cards: NearbyCard[]; results: Record<string, CardState>; error?: string };
type RouteState = { key: string; coords: LatLng[]; text: string; duration?: string };

// Boş değerler için sabit referanslar (her çizimde yeni nesne oluşup hook'ları tetiklemesin)
const NO_CARDS: NearbyCard[] = [];
const NO_METAS: LayerMeta[] = [];
const NO_RESULTS: Record<string, CardState> = {};

const toLatLng = (p: { lat: number; lng: number }): LatLng => ({ latitude: p.lat, longitude: p.lng });

function inRegion(it: Item, r: Region, pad = 0.25) {
  if (it.lat == null || it.lng == null) return false;
  return (
    Math.abs(it.lat - r.latitude) <= r.latitudeDelta * (0.5 + pad) && Math.abs(it.lng - r.longitude) <= r.longitudeDelta * (0.5 + pad)
  );
}

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  // Android: alt sayfa açılıştaki ilk ölçümü kaçırınca ekran dışında kalabiliyor (yavaş telefonda harita ve
  // veriler yüklenirken ölçüm gecikiyor). Tek seferlik gecikme her telefonda yetmediği için açılıştan sonraki
  // birkaç saniye boyunca sayfanın konumuna bakılır; ekran dışındaysa (-1) başlangıç konumuna gönderilir.
  // Kullanıcının kendi küçülttüğü sayfaya (0) dokunulmaz.
  const sheetPosition = useSharedValue(-1);
  const sheetWatched = useRef(false);
  const onRootLayout = useCallback(() => {
    if (sheetWatched.current) return;
    sheetWatched.current = true;
    for (const ms of SHEET_CHECKS_MS) {
      setTimeout(() => {
        if (sheetPosition.value < -0.5) sheetRef.current?.snapToIndex(1);
      }, ms);
    }
  }, [sheetPosition]);
  const fittedFor = useRef<string | null>(null);
  const userFocusedAt = useRef(0);
  const latestLayerKey = useRef<string | null>(null);

  const { location, locating, message: locationMessage, locate, setManual } = useUserLocation();
  const [serverMetas, setServerMetas] = useState<LayerMeta[]>([]);
  const [category, setCategory] = useState(OVERVIEW_ID);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, TravelMode>>({});
  const [meeting, setMeeting] = meetingStore.use();
  const [favorites, setFavorites] = favoritesStore.use();
  const [mahallem, setMahallem] = mahallemStore.use();
  const [reminders] = remindersStore.use();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 300);
  const [reloadKey, setReloadKey] = useState(0);
  const [metasError, setMetasError] = useState<string | null>(null);
  const [layerResult, setLayerResult] = useState<LayerResult | null>(null);
  const [pageState, setPageState] = useState({ key: '', limit: PAGE });
  const [overview, setOverview] = useState<OverviewState | null>(null);
  const [area, setArea] = areaStore.use();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);
  // Rota alınamayan seçim: kartta "hesaplanıyor" yerine kuş uçuşu mesafe gösterilir.
  const [routeFailed, setRouteFailed] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const mapStyle = useMapStyle(theme.scheme);
  const [sheetIndex, setSheetIndex] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  // Her istek, girdilerinden üretilen bir anahtar taşır. Yanıt kendi anahtarıyla saklanır; böylece
  // "yükleniyor" ve "hata" durumu buradan türetilir ve geç gelen eski yanıt yenisinin üstüne yazamaz.
  const { pack, routeFor } = useOffline(location);
  useNearbyAlerts(location, area, serverMetas);
  // Sunucuya hiç ulaşılamıyorsa bile (deprem sonrası gibi) Toplanma menüsü telefondaki kayıtla çalışsın.
  const metas = useMemo(
    () => (serverMetas.length ? serverMetas : metasError && pack ? [OFFLINE_TOPLANMA_META] : NO_METAS),
    [serverMetas, metasError, pack],
  );
  const meta = metas.find((m) => m.id === category) ?? null;
  const mode: TravelMode = modes[category] ?? meta?.defaultMode ?? 'arac';
  const layerKey =
    category === OVERVIEW_ID || !metas.length
      ? null
      : JSON.stringify([category, location.lat, location.lng, filters[category] ?? '', debouncedQuery.trim(), mode, reloadKey]);
  const overviewKey = category === OVERVIEW_ID ? JSON.stringify([location.lat, location.lng, reloadKey]) : null;
  // Rota, kaydın hangi modla ölçüldüğüne göre (kayıtta yoksa menünün varsayılanı) çizilir.
  const selectedMode: TravelMode = selected?.item.mode ?? metas.find((m) => m.id === selected?.layerId)?.defaultMode ?? 'arac';
  const selectionKey = selected ? `${selected.layerId}|${selected.item.id}|${location.lat},${location.lng}|${selectedMode}` : null;

  const currentOverview = overview && overview.key === overviewKey ? overview : null;
  const layerError = layerKey && layerResult?.key === layerKey ? layerResult.error : undefined;
  const serverDown = !!metasError || !!layerError || !!currentOverview?.error;
  const toplanmaOffline = category === 'toplanma' && !!pack && serverDown;
  const offlineData = useMemo(
    () => (pack && (category === 'toplanma' || category === OVERVIEW_ID) && serverDown ? offlineToplanma(pack, location, debouncedQuery) : null),
    [pack, category, serverDown, location, debouncedQuery],
  );

  // Aynı menüde arama/filtre değişirken eski liste yeni gelene kadar görünür kalsın.
  const data = toplanmaOffline ? offlineData : layerResult?.category === category ? (layerResult.data ?? null) : null;
  const loading = !toplanmaOffline && !!layerKey && layerResult?.key !== layerKey;
  const error = toplanmaOffline ? null : (metasError ?? layerError ?? currentOverview?.error ?? null);
  const limit = pageState.key === layerKey ? pageState.limit : PAGE;
  // Seçilen filtre (ör. "Yarın") hemen işaretli görünür; yeni liste gelene kadar eski liste yerine yükleniyor gösterilir.
  const chosenFilter = filters[category] ?? data?.filtre ?? null;
  const filterPending = loading && !!data && !!filters[category] && data.filtre !== filters[category];
  const cards = currentOverview?.cards ?? NO_CARDS;
  const cardResults = currentOverview?.results ?? NO_RESULTS;
  // İnternet yokken: en yakın toplanma alanına önceden kaydedilmiş yürüme rotası
  const savedRoute = selected && serverDown ? routeFor(selected.item.id, location) : null;
  const activeRoute = useMemo(
    () =>
      route?.key === selectionKey
        ? route
        : savedRoute && selectionKey
          ? {
              key: selectionKey,
              coords: savedRoute.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
              text: `${savedRoute.text} (kayıtlı rota)`,
            }
          : null,
    [route, selectionKey, savedRoute],
  );
  const visibleToast = toast ?? (locationMessage && locationMessage !== dismissedMessage ? locationMessage : null);

  const metaById = useMemo(() => Object.fromEntries(metas.map((m) => [m.id, m])), [metas]);
  const snapPoints = useMemo(() => SNAPS.map((p) => `${p * 100}%`), []);
  // Sayfa en üstteyken bile haritanın görünür kısmını orta yüksekliğe göre hesapla.
  const sheetHeight = height * SNAPS[Math.min(sheetIndex, 1)];

  const categories: Category[] = useMemo(
    () => [
      { id: OVERVIEW_ID, title: shortTitle(OVERVIEW_ID, 'Yakınımda'), color: OVERVIEW_COLOR },
      ...metas.map((m) => ({ id: m.id, title: shortTitle(m.id, m.navTitle), color: m.color })),
    ],
    [metas],
  );

  const fit = useCallback(
    (points: LatLng[]) => {
      if (points.length < 2) return;
      cameraRef.current?.fitBounds(boundsOf(points), {
        padding: { top: insets.top + 80, right: 70, bottom: sheetHeight + 30, left: 50 },
        duration: 500,
      });
    },
    [insets.top, sheetHeight],
  );

  // Nokta, alt sayfanın üstünde kalan görünür harita alanının ortasına gelir. Dolgu her seferinde açıkça
  // verilir; yoksa MapLibre önceki fitBounds dolgusunu kullanır ve nokta ekranın tepesine kayar.
  const flyTo = useCallback(
    (lat: number, lng: number, delta: number, duration: number) => {
      cameraRef.current?.easeTo({
        center: [lng, lat],
        zoom: zoomForDelta(delta),
        padding: { top: insets.top, right: 0, bottom: sheetHeight, left: 0 },
        duration,
      });
    },
    [insets.top, sheetHeight],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 6000);
  }, []);

  /* ---------- Veri ---------- */

  useEffect(() => {
    api
      .layers()
      .then((m) => {
        setServerMetas(m);
        setMetasError(null);
      })
      .catch((e: Error) => setMetasError(e.message));
  }, [reloadKey]);

  // Konum bilgilendirmesi birkaç saniye sonra kendiliğinden kapansın.
  useEffect(() => {
    if (!locationMessage) return;
    const t = setTimeout(() => setDismissedMessage(locationMessage), 7000);
    return () => clearTimeout(t);
  }, [locationMessage]);

  useEffect(() => {
    let alive = true;
    api
      .area(location)
      .then((a) => alive && setArea({ ...a, lat: location.lat, lng: location.lng }))
      .catch(() => alive && setArea(null));
    return () => {
      alive = false;
    };
  }, [location, setArea]);

  // Seçili menünün kayıtları (konum, filtre veya arama değişince yeniden)
  useEffect(() => {
    latestLayerKey.current = layerKey;
    if (!layerKey) return;
    const key = layerKey;
    const isCurrent = () => latestLayerKey.current === key;
    api
      .layer(category, { lat: location.lat, lng: location.lng, filtre: filters[category], q: debouncedQuery.trim(), mod: mode })
      .then((res) => isCurrent() && setLayerResult({ key, category, data: res }))
      .catch(
        (e: Error) =>
          isCurrent() &&
          setLayerResult((prev) => ({ key, category, data: prev?.category === category ? prev.data : undefined, error: e.message })),
      );
    // layerKey girdilerin hepsini içeriyor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey]);

  // Yakınımda kartları: liste gelir gelmez her kart kendi isteğiyle doldurulur.
  useEffect(() => {
    if (!overviewKey) return;
    const key = overviewKey;
    const onlyIfCurrent = (fn: (s: OverviewState) => OverviewState) => setOverview((prev) => (prev?.key === key ? fn(prev) : prev));
    api
      .nearbyCards()
      .then((list) => {
        setOverview({ key, cards: list, results: {} });
        for (const c of list) {
          api
            .nearby(c.id, location)
            .then((r) => onlyIfCurrent((s) => ({ ...s, results: { ...s.results, [c.id]: r } })))
            .catch((e: Error) => onlyIfCurrent((s) => ({ ...s, results: { ...s.results, [c.id]: { error: e.message } } })));
        }
      })
      .catch((e: Error) => setOverview({ key, cards: [], results: {}, error: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewKey]);

  /* ---------- Harita odaklama ---------- */

  // Menü açılınca (seçim yoksa) konumunuz + en yakın 3 kayıt görünecek şekilde odaklan.
  useEffect(() => {
    if (selected || category === OVERVIEW_ID || !data || meta?.noMap) return;
    const key = `${category}|${location.lat},${location.lng}|${filters[category] ?? ''}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    if (meta?.outage) {
      // Bütün İzmir'e uzaklaşmasın: yalnızca konumunuza yakın (5 km) etkilenen mahalleler gösterilir.
      // Yakında kesinti yoksa harita konumunuzda kalır; uzaktakiler listeden seçilince gösterilir.
      const near = data.items
        .flatMap(areaPoints)
        .filter((p) => haversine(location, { lat: p.latitude, lng: p.longitude }) <= NEAR_OUTAGE_M);
      if (near.length) fit([toLatLng(location), ...near]);
      else flyTo(location.lat, location.lng, 0.05, 500);
      return;
    }
    const nearest = data.items.filter((it) => it.lat != null && it.lng != null).slice(0, 3);
    if (nearest.length) fit([toLatLng(location), ...nearest.map((it) => ({ latitude: it.lat!, longitude: it.lng! }))]);
  }, [data, category, meta?.noMap, meta?.outage, selected, location, filters, fit, flyTo]);

  // Yakınımda: kartlardaki kayıtlar geldikçe hepsini kapsayacak şekilde odaklan.
  const overviewItems = useMemo(
    () =>
      cards.flatMap((c) => {
        const r = cardResults[c.id];
        return r && !('error' in r) && r.item?.lat != null ? [{ item: r.item, layerId: c.layer }] : [];
      }),
    [cards, cardResults],
  );
  // Yakınımda: konumunuz haritanın görünen kısmının (alt sayfanın üstü) tam ortasında durur; yakındaki kayıtlar
  // da görünecek kadar uzaklaşılır. Uzaktaki kayıtlar (ör. 100 km ötedeki deprem) haritayı uzaklaştırıp konumu
  // kenara itmesin diye hesaba katılmaz. Sınır kutusu konuma göre simetrik olduğundan konum hep ortada kalır.
  // Konum nesnesi değil koordinatlar izlenir: "Konumumu bul" aynı yeri yeniden bulunca harita geri uzaklaşmasın.
  const { lat: userLat, lng: userLng } = location;
  const centerOnUserArea = useCallback(
    (points: LatLng[]) => {
      const user = { lat: userLat, lng: userLng };
      const near = points.filter((p) => haversine(user, { lat: p.latitude, lng: p.longitude }) <= OVERVIEW_NEAR_M);
      const dLat = Math.max(MIN_HALF_SPAN, ...near.map((p) => Math.abs(p.latitude - userLat)));
      const dLng = Math.max(MIN_HALF_SPAN, ...near.map((p) => Math.abs(p.longitude - userLng)));
      cameraRef.current?.fitBounds([userLng - dLng, userLat - dLat, userLng + dLng, userLat + dLat], {
        padding: { top: insets.top + 70, right: 60, bottom: sheetHeight + 30, left: 60 },
        duration: 500,
      });
    },
    [userLat, userLng, insets.top, sheetHeight],
  );
  useEffect(() => {
    if (category !== OVERVIEW_ID || selected) return;
    // Kullanıcı az önce "Konumumu bul"a bastıysa onun sokak düzeyi yakınlığı korunur.
    if (Date.now() - userFocusedAt.current < USER_FOCUS_HOLD_MS) return;
    const t = setTimeout(() => centerOnUserArea(overviewItems.map(({ item }) => ({ latitude: item.lat!, longitude: item.lng! }))), 300);
    return () => clearTimeout(t);
  }, [overviewItems, category, selected, centerOnUserArea]);

  // Seçilen kayıt: önce düz çizgi, sonra Python servisinden gelen gerçek araç rotası.
  useEffect(() => {
    if (!selectionKey || !selected || selected.item.lat == null || selected.item.lng == null) return;
    const key = selectionKey;
    const target = { lat: selected.item.lat, lng: selected.item.lng };
    if (metaById[selected.layerId]?.outage) {
      const pts = areaPoints(selected.item);
      if (pts.length > 1) fit(pts);
      else flyTo(target.lat, target.lng, 0.03, 400);
      return;
    }
    fit([toLatLng(location), toLatLng(target)]);
    const saved = serverDown ? routeFor(selected.item.id, location) : null;
    if (saved) {
      fit(saved.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      return;
    }
    if (!metaById[selected.layerId]?.routing) return;
    let alive = true;
    api
      .route(location, target, selectedMode)
      .then((r) => {
        if (!alive) return;
        const coords = r.koordinatlar.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        setRoute({ key, coords, text: `${r.mesafeMetin} yol · ~${r.sureMetin} ${selectedMode === 'yuruyus' ? 'yürüyerek' : 'araçla'}`, duration: r.sureMetin });
        fit(coords);
      })
      .catch(() => {
        // rota yoksa düz çizgi ve kuş uçuşu mesafe kalır
        if (alive) setRouteFailed(key);
      });
    return () => {
      alive = false;
    };
    // fit bilerek dışarıda: sayfa yüksekliği değişince rota yeniden istenmesin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, metaById]);

  /* ---------- Eylemler ---------- */

  const chooseCategory = useCallback((id: string) => {
    Haptics.selectionAsync();
    setSelected(null);
    setQuery('');
    setCategory(id);
    fittedFor.current = null;
  }, []);

  const select = useCallback((item: Item, layerId: string) => {
    Haptics.selectionAsync();
    setSelected({ item, layerId });
    sheetRef.current?.snapToIndex(1);
  }, []);

  const openNearby = useCallback(
    (card: NearbyCard) => {
      const r = cardResults[card.id];
      setQuery('');
      setCategory(card.layer);
      fittedFor.current = null;
      if (r && !('error' in r) && r.item) select(r.item, card.layer);
      else setSelected(null);
    },
    [cardResults, select],
  );

  const openDirections = (it: Item) => {
    // Telefondaki harita uygulamasında (Google Haritalar vb.) yol tarifi
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lng}&travelmode=${it.mode === 'yuruyus' ? 'walking' : 'driving'}`,
    );
  };

  const share = (it: Item) =>
    Share.share({
      message: `${it.name}${it.sub ? ` – ${it.sub}` : ''}\nhttps://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}`,
    });

  const isFavorite = (it: Item, layerId: string) => favorites.some((f) => f.layerId === layerId && f.item.id === it.id);
  const toggleFavorite = (it: Item, layerId: string) => {
    Haptics.selectionAsync();
    setFavorites((list) =>
      list.some((f) => f.layerId === layerId && f.item.id === it.id)
        ? list.filter((f) => !(f.layerId === layerId && f.item.id === it.id))
        : [...list, { layerId, item: { ...it, dist: undefined, distText: undefined, durationText: null }, savedAt: Date.now() }],
    );
  };
  // Favoriler telefonda saklanır; mesafe cihazda (kuş uçuşu) hesaplanır, nöbet gibi değişen rozetler gösterilmez.
  const favoriteRows = favorites
    .filter((f) => f.item.lat != null && f.item.lng != null)
    .map((f) => {
      const d = haversine(location, { lat: f.item.lat!, lng: f.item.lng! });
      return { layerId: f.layerId, d, item: { ...f.item, badge: null, dist: d, distText: fmtDist(d), distKind: 'kus' as const, durationText: null } };
    })
    .sort((a, b) => a.d - b.d);

  const toggleMarketReminder = async (it: Item) => {
    if (reminders.pazar[it.id]) return removeMarketReminder(it.id);
    if (await addMarketReminder(it)) showToast('Pazarın kurulduğu günlerde sabah 08:00’de hatırlatılacak.');
    else showToast('Bildirim izni verilmedi. Ayarlar › Uygulamalar › Kent Pusulası › Bildirimler’den açabilirsiniz.');
  };

  const makeMahallem = () => {
    if (!area?.mahalle || !area.ilce) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMahallem({ ilce: area.ilce, mahalle: area.mahalle });
    if (pushStore.get().enabled) enablePush(pushStore.get().types).catch(() => {});
    showToast(`Mahalleniz: ${area.mahalle}. Bildirimleri zil düğmesinden açabilirsiniz.`);
  };

  // "Konumumu bul": hangi menü açık olursa olsun haritayı konuma sokak düzeyinde yakınlaştırır.
  // GPS konumu zaten biliniyorsa hemen oraya gider, yeni ölçüm gelince son konuma kayar.
  const centerOnUser = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    userFocusedAt.current = Date.now();
    if (location.source === 'gps') flyTo(location.lat, location.lng, USER_ZOOM_DELTA, 500);
    const found = await locate();
    userFocusedAt.current = Date.now();
    flyTo(found.lat, found.lng, USER_ZOOM_DELTA, 600);
  };


  /* ---------- Harita işaretleri ---------- */

  // Her işaret: hangi kayda ait (item), nerede duracağı (lat/lng) ve balon olup olamayacağı (primary).
  // Kesintilerde etkilenen HER mahallenin dairesinin ortasına bir işaret konur; seçilince balon, kaydın
  // kendi konumunda (size en yakın etkilenen mahalle) çıkar. Böylece işaretler hep dairelerin üstündedir.
  type MapMarker = { key: string; item: Item; layerId: string; lat: number; lng: number; large: boolean; primary: boolean };
  const markers = useMemo((): MapMarker[] => {
    const one = (item: Item, layerId: string, large: boolean): MapMarker => ({
      key: item.id, item, layerId, lat: item.lat!, lng: item.lng!, large, primary: true,
    });
    if (category === OVERVIEW_ID) return overviewItems.map((m) => one(m.item, m.layerId, true));
    if (!data || meta?.noMap || filterPending) return [];
    if (meta?.outage) {
      return data.items.flatMap((item) =>
        (item.areas ?? []).map((a) => ({
          key: `${item.id}|${a.name}`,
          item,
          layerId: category,
          lat: a.lat,
          lng: a.lng,
          large: false,
          primary: a.lat === item.lat && a.lng === item.lng,
        })),
      );
    }
    const visible = data.items.filter((it) => inRegion(it, region)).slice(0, MAX_MARKERS);
    const sel = selected?.item;
    if (sel && !visible.some((it) => it.id === sel.id)) visible.push(sel);
    return visible.map((item) => one(item, category, false));
  }, [category, overviewItems, data, meta?.noMap, meta?.outage, region, selected, filterPending]);

  /* ---------- Alt sayfa içeriği ---------- */

  const header = (
    <View>
      <CategoryBar categories={categories} active={category} onSelect={chooseCategory} theme={theme} />
      <View style={styles.titleBlock}>
        <Text style={[styles.largeTitle, { color: theme.label }]}>{category === OVERVIEW_ID ? 'Yakınımda' : meta?.title}</Text>
        <Text style={[styles.caption, { color: theme.secondary }]} numberOfLines={3}>
          {category === OVERVIEW_ID
            ? area?.mahalle
              ? `Tahmini bölgeniz: ${area.mahalle}, ${area.ilce}`
              : locating
                ? 'Konumunuz alınıyor…'
                : 'Konumunuza en yakın hizmetler'
            : data
              ? `${data.durum.eski ? 'Eski veri · ' : ''}${data.durum.damga ?? `Güncellendi: ${data.durum.guncellendiMetin}`}`
              : meta?.intro}
        </Text>
      </View>
      {category === OVERVIEW_ID && (mahallem || area?.mahalle) && (
        <View style={styles.mahallemRow}>
          <SymbolView name={SYM.home} size={13} tintColor={theme.secondary} />
          {mahallem ? (
            <Text style={[styles.caption, { color: theme.secondary, marginTop: 0, flex: 1 }]} onPress={() => router.push('/bildirimler')}>
              Mahallem: {mahallem.mahalle}, {mahallem.ilce} ›
            </Text>
          ) : (
            <Text style={[styles.caption, { color: theme.accent, marginTop: 0, flex: 1 }]} onPress={makeMahallem}>
              {area?.mahalle}’yi mahallem yap (kesinti bildirimleri için)
            </Text>
          )}
        </View>
      )}
      {meta?.search && (
        <View style={[styles.search, { backgroundColor: theme.fill }]}>
          <SymbolView name={SYM.search} size={15} tintColor={theme.secondary} />
          <BottomSheetTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={meta.searchPlaceholder}
            placeholderTextColor={theme.secondary}
            style={[styles.searchInput, { color: theme.label }]}
            clearButtonMode="while-editing"
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
      )}
      {meta?.routing && !meta.outage && (
        <View style={styles.modeRow}>
          <ModeToggle value={mode} onChange={(m) => setModes((prev) => ({ ...prev, [category]: m }))} theme={theme} />
        </View>
      )}
      {!!data?.filtreler.length && category !== OVERVIEW_ID && (
        <SegmentedControl
          style={styles.segmented}
          values={data.filtreler.map((f) => f.label)}
          selectedIndex={Math.max(0, data.filtreler.findIndex((f) => f.id === chosenFilter))}
          onChange={(e) => {
            const f = data.filtreler[e.nativeEvent.selectedSegmentIndex];
            if (f) setFilters((prev) => ({ ...prev, [category]: f.id }));
          }}
          appearance={theme.scheme}
        />
      )}
      {meta?.outage && (
        <View style={styles.legend}>
          {OUTAGE_LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { borderColor: l.color, backgroundColor: `${l.color}59` }]} />
              <Text style={[styles.small, { color: theme.secondary, marginTop: 0 }]}>{l.label}</Text>
            </View>
          ))}
          <Text style={[styles.small, { color: theme.tertiary, marginTop: 0 }]}>
            {data?.items.some((it) => it.shape) ? 'Alanlar etkilenen sokakları kapsar' : 'Daireler etkilenen mahallelerin yaklaşık alanı'}
          </Text>
        </View>
      )}
      {category !== OVERVIEW_ID && data && !filterPending && !meta?.noMap && data.items.length > 0 && (
        <Text style={[styles.listMeta, { color: theme.secondary }]}>
          {data.items.length} kayıt ·{' '}
          {data.mesafe.tur === 'yol' ? `${data.mesafe.mod === 'yuruyus' ? 'yürüyerek' : 'araçla'} en yakından` : 'kuş uçuşu en yakından'}
        </Text>
      )}
    </View>
  );

  const empty = loading ? (
    <ActivityIndicator style={styles.spinner} />
  ) : error ? (
    <View style={[styles.notice, { backgroundColor: theme.group }]}>
      <Text style={[styles.noticeTitle, { color: theme.label }]}>Veri alınamadı</Text>
      <Text style={[styles.caption, { color: theme.secondary }]}>{meta?.errorText ?? error}</Text>
      <Text style={[styles.small, { color: theme.tertiary }]}>{error}</Text>
      <Pressable onPress={() => setReloadKey((k) => k + 1)} style={[styles.retry, { backgroundColor: theme.accent }]}>
        <Text style={styles.retryText}>Tekrar dene</Text>
      </Pressable>
    </View>
  ) : data ? (
    <Text style={[styles.emptyText, { color: theme.secondary }]}>{query ? 'Aramayla eşleşen kayıt yok.' : meta?.emptyText}</Text>
  ) : null;

  const selectedMeta = selected ? metaById[selected.layerId] : null;
  // Gerçek yol mesafesi gelene kadar kartta kuş uçuşu yerine "hesaplanıyor" yazar (önce kuş uçuşu sonra yol
  // mesafesi görünüp kullanıcıyı şaşırtmasın).
  const routePending =
    !!selected &&
    selected.item.lat != null &&
    !!selectedMeta?.routing &&
    !selectedMeta.outage &&
    !activeRoute &&
    !serverDown &&
    routeFailed !== selectionKey;

  // Kesintide etkilenen mahalleler ve hazırlık endeksi: metre cinsinden renkli daireler
  const circleShapes = useMemo((): GeoJSON.FeatureCollection => {
    const circle = (lat: number, lng: number, radius: number, color: string, op: number, lw: number): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { color, op, lw },
      geometry: { type: 'Polygon', coordinates: [circleRing(lat, lng, radius)] },
    });
    if (meta?.outage && data) {
      return {
        type: 'FeatureCollection',
        features: data.items.flatMap((it): GeoJSON.Feature[] => {
          const isSel = selected?.item.id === it.id;
          const [op, lw] = isSel ? [0.38, 3] : [0.2, 1.5];
          // Gediz kaydı: etkilenen sokakları kapsayan gerçek alan. Çok küçükse (birkaç ev) daire daha görünür.
          if (it.shape && (it.areas?.[0]?.r ?? 0) > SMALL_SHAPE_M) {
            return [{ type: 'Feature', properties: { color: it.color, op, lw }, geometry: { type: 'Polygon', coordinates: [it.shape.ring] } }];
          }
          return (it.areas ?? []).map((a) => circle(a.lat, a.lng, a.r ?? AREA_RADIUS, it.color, op, lw));
        }),
      };
    }
    if (meta?.areaCircles) {
      return {
        type: 'FeatureCollection',
        features: markers.map(({ item }) => {
          const isSel = selected?.item.id === item.id;
          return circle(item.lat!, item.lng!, 420, item.color, isSel ? 0.4 : 0.2, isSel ? 2.5 : 1);
        }),
      };
    }
    return EMPTY_FC;
  }, [meta?.outage, meta?.areaCircles, data, markers, selected]);

  // Kesintide etkilenen mahallelerin adları (dairelerin ortasında; yakınlaşınca görünür)
  const areaLabels = useMemo((): GeoJSON.FeatureCollection => {
    if (!meta?.outage || !data || filterPending) return EMPTY_FC;
    const seen = new Set<string>();
    const features: GeoJSON.Feature[] = [];
    for (const it of data.items) {
      for (const a of it.areas ?? []) {
        const k = `${a.name}|${a.lat}|${a.lng}`;
        if (seen.has(k)) continue;
        seen.add(k);
        features.push({
          type: 'Feature',
          properties: { name: a.name, color: it.color, sel: selected?.item.id === it.id },
          geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [meta?.outage, data, filterPending, selected]);

  // Haritadaki işaretler (kategori kayıtları, buluşma noktası, elle seçilen konum) tek GeoJSON olarak
  const markerShapes = useMemo((): GeoJSON.FeatureCollection => {
    const pin = (key: string, lat: number, lng: number, color: string, icon: string | null, size: keyof typeof PIN, z: number): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { key, color, icon: icon ?? '', ...PIN[size], sel: size === 'selected', z },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
    const androidIcon = (name: ReturnType<typeof symbolFor>) => (typeof name === 'object' && name.android ? String(name.android) : 'place');
    const features: GeoJSON.Feature[] = markers.map(({ key, item, layerId, lat, lng, large, primary }) => {
      const isSel = selected?.item.id === item.id;
      const size = isSel && primary ? 'selected' : large || isSel ? 'large' : 'small';
      return pin(key, lat, lng, item.color, androidIcon(symbolFor(layerId)), size, size === 'selected' ? 3 : size === 'large' ? 2 : 1);
    });
    if (meeting) features.push(pin(`bulusma-${meeting.id}`, meeting.lat, meeting.lng, MEETING_COLOR, 'flag', 'large', 4));
    if (location.source !== 'gps') {
      const dot = location.source === 'manual' ? theme.accent : location.source === 'ip' ? theme.orange : '#8e8e93';
      features.push(pin('konum', location.lat, location.lng, dot, null, 'dot', 5));
    }
    return { type: 'FeatureCollection', features };
  }, [markers, selected, meeting, location, theme.accent, theme.orange]);

  // Harita (stil değişince) yeniden kurulduğunda son görünen bölgeden açılsın; ilk açılışta konum
  // zaten bulunduysa oradan başlar.
  const styleKey = mapStyle ? theme.scheme : null;
  const initialView = useMemo(() => {
    const r = region === INITIAL_REGION && location.source !== 'default' ? { ...toLatLng(location), longitudeDelta: 0.03 } : region;
    return { center: [r.longitude, r.latitude] as [number, number], zoom: zoomForDelta(r.longitudeDelta) };
    // yalnızca harita yeniden kurulurken
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  const onMarkerPress = useCallback(
    (e: { nativeEvent: { features?: GeoJSON.Feature[] } }) => {
      const hit = [...(e.nativeEvent.features ?? [])].sort((a, b) => Number(b.properties?.z ?? 0) - Number(a.properties?.z ?? 0))[0];
      const key = hit?.properties?.key;
      const m = markers.find((x) => x.key === key);
      if (m) select(m.item, m.layerId);
    },
    [markers, select],
  );

  // Seçili kayda rota: gerçek rota gelene kadar kesikli düz çizgi
  const routeShape = useMemo((): GeoJSON.FeatureCollection => {
    if (!selected || selected.item.lat == null || selected.item.lng == null || selectedMeta?.outage || selectedMeta?.areaCircles) return EMPTY_FC;
    const coords = activeRoute?.coords ?? [toLatLng(location), { latitude: selected.item.lat, longitude: selected.item.lng }];
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: activeRoute ? 'route' : 'straight' },
          geometry: { type: 'LineString', coordinates: coords.map((c) => [c.longitude, c.latitude]) },
        },
      ],
    };
  }, [selected, selectedMeta?.outage, selectedMeta?.areaCircles, activeRoute, location]);

  return (
    <View style={[styles.root, { backgroundColor: theme.sheet }]} onLayout={onRootLayout}>
      {/* Stil hazır olunca çizilir. Stil (açık / koyu tema) değişince harita baştan kurulur ama kaldığı yerden açılır;
          böylece işaret simgeleri ve katmanlar yeni stile eksiksiz eklenir. */}
      {mapStyle && (
        <MapLibreMap
          key={styleKey}
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          logo={false}
          attribution
          attributionPosition={{ top: insets.top + 12, left: 8 }}
          compass
          compassPosition={{ top: insets.top + 159, right: 14 }}
          tintColor={theme.accent}
          onRegionDidChange={(e) => setRegion(regionFromBounds(e.nativeEvent.bounds))}
          onLongPress={(e) => {
            const [lng, lat] = e.nativeEvent.lngLat;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setManual(lat, lng);
            showToast('Konumunuz haritada seçtiğiniz nokta olarak ayarlandı.');
          }}
        >
          <Camera ref={cameraRef} initialViewState={initialView} />

          <GeoJSONSource id="daireler" data={circleShapes}>
            <Layer id="daire-dolgu" type="fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] }} />
            <Layer id="daire-kenar" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'lw'] }} />
          </GeoJSONSource>

          <GeoJSONSource id="mahalle-adlari" data={areaLabels}>
            <Layer
              id="mahalle-adi"
              type="symbol"
              minzoom={12.5}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 12,
                'text-offset': [0, 1.6],
                'text-anchor': 'top',
                'text-max-width': 8,
              }}
              paint={{ 'text-color': ['get', 'color'], 'text-halo-color': theme.scheme === 'dark' ? '#1c1c1e' : '#ffffff', 'text-halo-width': 1.5 }}
            />
          </GeoJSONSource>

          <GeoJSONSource id="rota" data={routeShape}>
            <Layer
              id="rota-alt"
              type="line"
              filter={['==', ['get', 'kind'], 'route']}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': theme.routeCasing, 'line-width': 9 }}
            />
            <Layer
              id="rota-ust"
              type="line"
              filter={['==', ['get', 'kind'], 'route']}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': theme.accent, 'line-width': 6 }}
            />
            <Layer
              id="rota-kesikli"
              type="line"
              filter={['==', ['get', 'kind'], 'straight']}
              layout={{ 'line-cap': 'round' }}
              paint={{ 'line-color': theme.accent, 'line-width': 3, 'line-dasharray': [0.7, 2.7] }}
            />
          </GeoJSONSource>

          {location.source === 'gps' && <UserLocation accuracy />}
          {/* İşaretler haritanın kendi katmanında: kaydırırken haritaya yapışık kalır */}
          <Images images={MAP_ICONS} />
          <GeoJSONSource id="isaretler" data={markerShapes} onPress={onMarkerPress} hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            {/* Yuvarlak işaretler (iOS'taki gibi beyaz kenarlı, hafif gölgeli) */}
            <Layer
              id="isaret-golge"
              type="circle"
              filter={NOT_SELECTED}
              layout={{ 'circle-sort-key': ['get', 'z'] }}
              paint={{
                'circle-radius': ['+', ['get', 'r'], ['get', 'sw'], 1],
                'circle-color': '#000000',
                'circle-opacity': 0.22,
                'circle-blur': 0.5,
                'circle-translate': [0, 1],
              }}
            />
            <Layer
              id="isaret-daire"
              type="circle"
              filter={NOT_SELECTED}
              layout={{ 'circle-sort-key': ['get', 'z'] }}
              paint={{
                'circle-radius': ['get', 'r'],
                'circle-color': ['get', 'color'],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': ['get', 'sw'],
              }}
            />
            <Layer
              id="isaret-simge"
              type="symbol"
              filter={NOT_SELECTED}
              layout={{
                'icon-image': ['get', 'icon'],
                'icon-size': ['get', 'is'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'symbol-sort-key': ['get', 'z'],
              }}
            />
            {/* Seçili kayıt: altında uç olan büyük balon; en üstte çizilir */}
            <Layer
              id="secili-golge"
              type="circle"
              filter={IS_SELECTED}
              paint={{
                'circle-radius': PIN.selected.r + PIN.selected.sw + 1.5,
                'circle-color': '#000000',
                'circle-opacity': 0.25,
                'circle-blur': 0.4,
                'circle-translate': [0, 1.5 - BALLOON_LIFT],
              }}
            />
            <Layer
              id="secili-uc"
              type="symbol"
              filter={IS_SELECTED}
              layout={{ 'icon-image': 'pin_tail', 'icon-size': 0.125, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true }}
            />
            <Layer
              id="secili-daire"
              type="circle"
              filter={IS_SELECTED}
              paint={{
                'circle-radius': ['get', 'r'],
                'circle-color': ['get', 'color'],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': ['get', 'sw'],
                'circle-translate': [0, -BALLOON_LIFT],
              }}
            />
            <Layer
              id="secili-simge"
              type="symbol"
              filter={IS_SELECTED}
              layout={{ 'icon-image': ['get', 'icon'], 'icon-size': ['get', 'is'], 'icon-allow-overlap': true, 'icon-ignore-placement': true }}
              paint={{ 'icon-translate': [0, -BALLOON_LIFT] }}
            />
          </GeoJSONSource>
        </MapLibreMap>
      )}

      {/* Sağ üst: bildirimler, hakkında, konumum */}
      <View style={[styles.mapButtons, { top: insets.top + 8, backgroundColor: theme.floating }]}>
        <Pressable style={styles.mapButton} onPress={() => router.push('/bildirimler')} accessibilityLabel="Bildirimler, hatırlatıcılar ve mahallem">
          <SymbolView name={SYM.bell} size={18} tintColor={theme.accent} />
        </Pressable>
        <View style={[styles.mapButtonSep, { backgroundColor: theme.separator }]} />
        <Pressable style={styles.mapButton} onPress={() => router.push('/hakkinda')} accessibilityLabel="Hakkında, kaynaklar ve acil durum">
          <SymbolView name={SYM.info} size={19} tintColor={theme.accent} />
        </Pressable>
        <View style={[styles.mapButtonSep, { backgroundColor: theme.separator }]} />
        <Pressable style={styles.mapButton} onPress={centerOnUser} accessibilityLabel="Konumumu bul">
          {locating ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <SymbolView name={location.source === 'gps' ? SYM.locate : SYM.locateOff} size={19} tintColor={theme.accent} />
          )}
        </Pressable>
      </View>

      {!!visibleToast && (
        <Pressable
          onPress={() => {
            setToast(null);
            setDismissedMessage(locationMessage);
          }}
          style={[styles.toast, { top: insets.top + 8, backgroundColor: theme.toast }]}
        >
          <Text style={styles.toastText}>{visibleToast}</Text>
        </Pressable>
      )}

      <BottomSheet
        ref={sheetRef}
        index={1}
        snapPoints={snapPoints}
        animatedIndex={sheetPosition}
        // Açılış animasyonu ölçümden önce başlayıp sayfayı ekran dışında bırakabiliyor; doğrudan yerine konsun.
        animateOnMount={false}
        enableDynamicSizing={false}
        onChange={(i) => setSheetIndex(Math.max(0, i))}
        topInset={insets.top}
        keyboardBehavior="extend"
        backgroundStyle={{ backgroundColor: theme.sheet }}
        handleIndicatorStyle={{ backgroundColor: theme.tertiary, width: 38 }}
      >
        {selected ? (
          <BottomSheetScrollView>
            <PlaceCard
              item={selected.item}
              categoryTitle={selectedMeta?.title ?? ''}
              theme={theme}
              routeText={activeRoute?.text ?? null}
              routeDuration={activeRoute?.duration ?? null}
              routePending={routePending}
              canNavigate={!selectedMeta?.outage}
              meeting={
                selected.layerId === 'toplanma' && selected.item.lat != null
                  ? {
                      isThis: meeting?.id === selected.item.id,
                      onSet: () => {
                        const it = selected.item;
                        const point = { id: it.id, name: it.name, sub: it.sub, lat: it.lat!, lng: it.lng! };
                        setMeeting(point);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        shareMeetingPoint(point);
                      },
                      onClear: () => setMeeting(null),
                      onShare: () => meeting && shareMeetingPoint(meeting),
                    }
                  : undefined
              }
              favorite={
                selected.item.lat != null && !selectedMeta?.outage && !selectedMeta?.areaCircles && selected.layerId !== 'deprem'
                  ? { on: isFavorite(selected.item, selected.layerId), onToggle: () => toggleFavorite(selected.item, selected.layerId) }
                  : undefined
              }
              reminder={
                selected.layerId === 'pazar' && selected.item.days?.length
                  ? {
                      on: !!reminders.pazar[selected.item.id],
                      text: `${dayNames(selected.item.days)} · 08:00`,
                      onToggle: () => toggleMarketReminder(selected.item),
                    }
                  : undefined
              }
              onClose={() => setSelected(null)}
              onDirections={() => openDirections(selected.item)}
              onCall={() => selected.item.phone && Linking.openURL(`tel:${selected.item.phone}`)}
              onShare={() => share(selected.item)}
            />
          </BottomSheetScrollView>
        ) : category === OVERVIEW_ID ? (
          <BottomSheetScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
            {header}
            <MeetingCard
              point={meeting}
              from={location}
              theme={theme}
              onPick={() => {
                chooseCategory('toplanma');
                showToast('Bir toplanma alanına dokunup “Aile buluşma noktası yap”ı seçin.');
              }}
              onOpen={() => meeting && flyTo(meeting.lat, meeting.lng, 0.012, 500)}
            />
            {favoriteRows.length > 0 && (
              <View>
                <Text style={[styles.offlineTitle, { color: theme.label }]}>Favorilerim</Text>
                <View style={[styles.group, { backgroundColor: theme.group }]}>
                  {favoriteRows.map(({ item, layerId }, i) => (
                    <View key={`${layerId}-${item.id}`}>
                      {i > 0 && <Separator theme={theme} />}
                      <PlaceRow item={item} symbol={symbolFor(layerId)} onPress={(x) => select(x, layerId)} theme={theme} />
                    </View>
                  ))}
                </View>
              </View>
            )}
            {error && offlineData ? (
              <View>
                <Text style={[styles.offlineTitle, { color: theme.label }]}>İnternet yok · en yakın toplanma alanları</Text>
                <Text style={[styles.offlineSub, { color: theme.secondary }]}>{offlineData.durum.damga}</Text>
                <View style={[styles.group, { backgroundColor: theme.group }]}>
                  {offlineData.items.slice(0, 3).map((it, i) => (
                    <View key={it.id}>
                      {i > 0 && <Separator theme={theme} />}
                      <PlaceRow item={it} symbol={symbolFor('toplanma')} onPress={(x) => select(x, 'toplanma')} theme={theme} />
                    </View>
                  ))}
                </View>
              </View>
            ) : error ? (
              empty
            ) : (
              <View style={[styles.group, { backgroundColor: theme.group }]}>
                {cards.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <Separator theme={theme} />}
                    <NearbyRow
                      label={c.label}
                      symbol={symbolFor(c.layer)}
                      color={metaById[c.layer]?.color ?? OVERVIEW_COLOR}
                      result={cardResults[c.id]}
                      onPress={() => openNearby(c)}
                      theme={theme}
                    />
                  </View>
                ))}
                {!cards.length && <ActivityIndicator style={styles.spinner} />}
              </View>
            )}
            <Text style={[styles.disclaimer, { color: theme.tertiary }]} onPress={() => router.push('/hakkinda')}>
              Bilgiler kamu kurumlarının açık verilerinden alınır ve bilgilendirme amaçlıdır. Acil durumda 112’yi arayın. Kaynaklar ›
            </Text>
          </BottomSheetScrollView>
        ) : (
          <BottomSheetFlatList<Item>
            data={filterPending ? [] : (data?.items.slice(0, limit) ?? [])}
            keyExtractor={(it) => it.id}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            ItemSeparatorComponent={meta?.noMap ? undefined : () => <Separator theme={theme} />}
            renderItem={({ item }) =>
              item.price ? (
                <PriceRow item={item} theme={theme} />
              ) : meta?.noMap || meta?.outage ? (
                <OutageRow item={item} theme={theme} onPress={(it) => select(it, category)} />
              ) : (
                <PlaceRow item={item} symbol={symbolFor(category)} onPress={(it) => select(it, category)} theme={theme} />
              )
            }
            onEndReached={() => data && layerKey && limit < data.items.length && setPageState({ key: layerKey, limit: limit + PAGE })}
            onEndReachedThreshold={0.5}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollPad}
          />
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleBlock: { paddingHorizontal: 16, paddingTop: 10 },
  largeTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  caption: { fontSize: 13.5, marginTop: 2 },
  small: { fontSize: 12, marginTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 10, height: 38, borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 16, height: 38 },
  segmented: { marginHorizontal: 16, marginTop: 12 },
  listMeta: { fontSize: 12.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  modeRow: { paddingHorizontal: 16, paddingTop: 12 },
  offlineTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18 },
  offlineSub: { fontSize: 12.5, paddingHorizontal: 16, paddingTop: 2 },
  mahallemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  group: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, overflow: 'hidden' },
  scrollPad: { paddingBottom: 60 },
  disclaimer: { fontSize: 12, lineHeight: 16, paddingHorizontal: 20, paddingTop: 14, textAlign: 'center' },
  spinner: { marginVertical: 24 },
  emptyText: { textAlign: 'center', marginTop: 30, paddingHorizontal: 24, fontSize: 14 },
  notice: { margin: 16, padding: 16, borderRadius: 12 },
  noticeTitle: { fontSize: 16, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  retryText: { color: '#ffffff', fontWeight: '600' },
  mapButtons: {
    position: 'absolute',
    right: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  mapButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  mapButtonSep: { height: StyleSheet.hairlineWidth },
  toast: { position: 'absolute', left: 12, right: 70, padding: 12, borderRadius: 14 },
  toastText: { color: '#ffffff', fontSize: 13.5 },
});
