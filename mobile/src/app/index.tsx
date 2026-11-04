// Ana ekran: tam ekran Apple Haritalar + alttan sürüklenen sayfa (kategoriler, liste, yer kartı).
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, type LatLng, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryBar, type Category } from '@/components/CategoryBar';
import { MEETING_COLOR, MeetingCard, shareMeetingPoint } from '@/components/MeetingCard';
import { ModeToggle } from '@/components/ModeToggle';
import { PinMarker } from '@/components/PinMarker';
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
import { useTheme } from '@/lib/theme';

const SNAPS = [0.2, 0.5, 0.9];
const INITIAL_REGION: Region = { latitude: 38.4189, longitude: 27.1287, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const MAX_MARKERS = 150; // performans: yalnızca görünen alandaki en yakın kayıtlar çizilir
const AREA_RADIUS = 450; // metre: kesintide etkilenen mahalle dairesi
const OUTAGE_LEGEND = [
  { label: 'Arıza', color: '#ff9500' },
  { label: 'Planlı', color: '#5856d6' },
];
const areaPoints = (it: Item): LatLng[] => (it.areas ?? []).map((a) => ({ latitude: a.lat, longitude: a.lng }));
const PAGE = 60;

type Selection = { item: Item; layerId: string };
type CardState = NearbyResult | { error: string };
type LayerResult = { key: string; category: string; data?: LayerResponse; error?: string };
type OverviewState = { key: string; cards: NearbyCard[]; results: Record<string, CardState>; error?: string };
type RouteState = { key: string; coords: LatLng[]; text: string };

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
  const mapRef = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const fittedFor = useRef<string | null>(null);
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
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');
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
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: insets.top + 80, right: 70, bottom: sheetHeight + 30, left: 50 },
        animated: true,
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
      const all = data.items.flatMap(areaPoints);
      if (all.length > 1) fit(all);
      return;
    }
    const nearest = data.items.filter((it) => it.lat != null && it.lng != null).slice(0, 3);
    if (nearest.length) fit([toLatLng(location), ...nearest.map((it) => ({ latitude: it.lat!, longitude: it.lng! }))]);
  }, [data, category, meta?.noMap, meta?.outage, selected, location, filters, fit]);

  // Yakınımda: kartlardaki kayıtlar geldikçe hepsini kapsayacak şekilde odaklan.
  const overviewItems = useMemo(
    () =>
      cards.flatMap((c) => {
        const r = cardResults[c.id];
        return r && !('error' in r) && r.item?.lat != null ? [{ item: r.item, layerId: c.layer }] : [];
      }),
    [cards, cardResults],
  );
  useEffect(() => {
    if (category !== OVERVIEW_ID || selected || !overviewItems.length) return;
    const t = setTimeout(() => fit([toLatLng(location), ...overviewItems.map(({ item }) => ({ latitude: item.lat!, longitude: item.lng! }))]), 300);
    return () => clearTimeout(t);
  }, [overviewItems, category, selected, location, fit]);

  // Seçilen kayıt: önce düz çizgi, sonra Python servisinden gelen gerçek araç rotası.
  useEffect(() => {
    if (!selectionKey || !selected || selected.item.lat == null || selected.item.lng == null) return;
    const key = selectionKey;
    const target = { lat: selected.item.lat, lng: selected.item.lng };
    if (metaById[selected.layerId]?.outage) {
      const pts = areaPoints(selected.item);
      if (pts.length > 1) fit(pts);
      else mapRef.current?.animateToRegion({ ...toLatLng(target), latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
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
        setRoute({ key, coords, text: `${r.mesafeMetin} yol · ~${r.sureMetin} ${selectedMode === 'yuruyus' ? 'yürüyerek' : 'araçla'}` });
        fit(coords);
      })
      .catch(() => {
        /* rota yoksa düz çizgi kalır */
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
    const url = Platform.select({
      ios: `https://maps.apple.com/?daddr=${it.lat},${it.lng}&dirflg=${it.mode === 'yuruyus' ? 'w' : 'd'}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lng}&travelmode=${it.mode === 'yuruyus' ? 'walking' : 'driving'}`,
    });
    Linking.openURL(url);
  };

  const share = (it: Item) =>
    Share.share({
      message: `${it.name}${it.sub ? ` – ${it.sub}` : ''}\nhttps://maps.apple.com/?ll=${it.lat},${it.lng}&q=${encodeURIComponent(it.name)}`,
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
    else showToast('Bildirim izni verilmedi. Ayarlar › Bildirimler’den açabilirsiniz.');
  };

  const makeMahallem = () => {
    if (!area?.mahalle || !area.ilce) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMahallem({ ilce: area.ilce, mahalle: area.mahalle });
    if (pushStore.get().enabled) enablePush(pushStore.get().types).catch(() => {});
    showToast(`Mahalleniz: ${area.mahalle}. Bildirimleri zil düğmesinden açabilirsiniz.`);
  };

  const centerOnUser = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await locate();
  };

  useEffect(() => {
    if (!selected && category === OVERVIEW_ID) {
      mapRef.current?.animateToRegion({ ...toLatLng(location), latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    }
    // yalnızca konum değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

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
    if (!data || meta?.noMap) return [];
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
  }, [category, overviewItems, data, meta?.noMap, meta?.outage, region, selected]);

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
          selectedIndex={Math.max(0, data.filtreler.findIndex((f) => f.id === data.filtre))}
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
          <Text style={[styles.small, { color: theme.tertiary, marginTop: 0 }]}>Daireler etkilenen mahalleler</Text>
        </View>
      )}
      {category !== OVERVIEW_ID && data && !meta?.noMap && data.items.length > 0 && (
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

  return (
    <View style={[styles.root, { backgroundColor: theme.sheet }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        mapType={mapType}
        showsUserLocation={location.source === 'gps'}
        showsPointsOfInterests={false}
        showsCompass
        pitchEnabled
        userInterfaceStyle={theme.scheme}
        tintColor={theme.accent}
        onRegionChangeComplete={setRegion}
        onLongPress={(e) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setManual(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
          showToast('Konumunuz haritada seçtiğiniz nokta olarak ayarlandı.');
        }}
      >
        {location.source !== 'gps' && (
          <Marker coordinate={toLatLng(location)} anchor={{ x: 0.5, y: 0.5 }} zIndex={200}>
            <View style={[styles.userDot, { backgroundColor: location.source === 'manual' ? theme.accent : location.source === 'ip' ? theme.orange : '#8e8e93' }]} />
          </Marker>
        )}

        {meta?.outage &&
          data?.items.flatMap((it) =>
            (it.areas ?? []).map((a) => {
              const isSel = selected?.item.id === it.id;
              return (
                <Circle
                  key={`${it.id}-${a.name}`}
                  center={{ latitude: a.lat, longitude: a.lng }}
                  radius={AREA_RADIUS}
                  strokeColor={it.color}
                  strokeWidth={isSel ? 2.5 : 1}
                  fillColor={`${it.color}${isSel ? '55' : '26'}`}
                  zIndex={isSel ? 5 : 1}
                />
              );
            }),
          )}

        {meta?.areaCircles &&
          markers.map(({ key, item }) => (
            <Circle
              key={`circle-${key}`}
              center={{ latitude: item.lat!, longitude: item.lng! }}
              radius={420}
              strokeColor={item.color}
              strokeWidth={selected?.item.id === item.id ? 2.5 : 1}
              fillColor={`${item.color}${selected?.item.id === item.id ? '66' : '33'}`}
            />
          ))}

        {selected && selected.item.lat != null && !selectedMeta?.outage && !selectedMeta?.areaCircles && (
          <Polyline
            coordinates={activeRoute?.coords ?? [toLatLng(location), { latitude: selected.item.lat, longitude: selected.item.lng! }]}
            strokeColor={activeRoute ? theme.routeCasing : theme.accent}
            strokeWidth={activeRoute ? 9 : 3}
            lineDashPattern={activeRoute ? undefined : [2, 8]}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {activeRoute && <Polyline coordinates={activeRoute.coords} strokeColor={theme.accent} strokeWidth={6} lineCap="round" lineJoin="round" />}

        {meeting && (
          <PinMarker
            key={`bulusma-${meeting.id}`}
            lat={meeting.lat}
            lng={meeting.lng}
            color={MEETING_COLOR}
            symbol={SYM.flag}
            title={`Buluşma noktası: ${meeting.name}`}
            large
          />
        )}
        {markers.map(({ key, item, layerId, lat, lng, large, primary }) => {
          const isSel = selected?.item.id === item.id;
          const balloon = isSel && primary;
          return (
            <PinMarker
              key={`${key}${balloon ? '-sel' : isSel ? '-on' : ''}`}
              lat={lat}
              lng={lng}
              color={item.color}
              symbol={symbolFor(layerId)}
              title={item.name}
              selected={balloon}
              large={large || (isSel && !primary)}
              onPress={() => select(item, layerId)}
            />
          );
        })}
      </MapView>

      {/* Sağ üst: harita türü + konumum (Apple Haritalar'daki gibi) */}
      <View style={[styles.mapButtons, { top: insets.top + 8, backgroundColor: theme.floating }]}>
        <Pressable
          style={styles.mapButton}
          onPress={() => setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'))}
          accessibilityLabel={mapType === 'standard' ? 'Uydu görünümüne geç' : 'Standart haritaya geç'}
        >
          <SymbolView name={mapType === 'standard' ? SYM.globe : SYM.map} size={19} tintColor={theme.accent} />
        </Pressable>
        <View style={[styles.mapButtonSep, { backgroundColor: theme.separator }]} />
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
            <ActivityIndicator size="small" />
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
              onOpen={() => meeting && mapRef.current?.animateToRegion({ latitude: meeting.lat, longitude: meeting.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500)}
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
            data={data?.items.slice(0, limit) ?? []}
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
  userDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#ffffff' },
});
