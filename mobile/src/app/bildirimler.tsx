// Bildirimler ve Mahallem: anlık kesinti/deprem bildirimleri (B6), hatırlatıcılar (B8), mahalle seçimi (B7).
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Item } from '@/lib/api';
import { SYM } from '@/lib/categories';
import { RADII, radiusLabel } from '@/lib/nearbyAlerts';
import { alertsStore, areaStore, mahallemStore, pushStore, remindersStore, type PushSettings } from '@/lib/persistent';
import { disablePush, enablePush, isExpoGo, PushUnavailable } from '@/lib/push';
import { dayNames, ensureNotificationPermission, removeMarketReminder, setMonthlyPrep } from '@/lib/reminders';
import { useTheme, type Theme } from '@/lib/theme';

const TYPE_LABELS: { id: PushSettings['types'][number]; label: string; sub: string }[] = [
  { id: 'su', label: 'Su kesintisi', sub: 'Mahallenizde ya da yakınında arıza / planlı kesinti duyurulunca' },
  { id: 'elektrik', label: 'Elektrik kesintisi', sub: 'Mahallenizde ya da yakınında planlı / arıza kesintisi duyurulunca' },
  { id: 'hava', label: 'Hava kalitesi', sub: 'En yakın ölçüm istasyonunda PM10 100 µg/m³’ü aşınca' },
  { id: 'deprem', label: 'Deprem (M4 ve üstü)', sub: 'İzmir ve çevresinde M4+ deprem olunca (AFAD)' },
];

export default function Notifications() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mahallem, setMahallem] = mahallemStore.use();
  const [area] = areaStore.use();
  const [push] = pushStore.use();
  const [reminders] = remindersStore.use();
  const [alerts, setAlerts] = alertsStore.use();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [neighbourhoods, setNeighbourhoods] = useState<Item[] | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof PushUnavailable ? e.message : `İşlem yapılamadı: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const chooseMahalle = (m: { ilce: string; mahalle: string }) =>
    run(async () => {
      setMahallem(m);
      setSearch('');
      if (pushStore.get().enabled) await enablePush(pushStore.get().types); // aboneliği yeni mahalleye taşı
    });

  const togglePush = (on: boolean) => run(() => (on ? enablePush(push.types) : disablePush()));
  const toggleType = (id: PushSettings['types'][number], on: boolean) => {
    const types = on ? [...new Set([...push.types, id])] : push.types.filter((t) => t !== id);
    if (!types.length) return setMessage('En az bir bildirim türü açık kalmalı.');
    if (!push.enabled) return pushStore.set({ ...push, types });
    return run(() => enablePush(types));
  };

  const chooseRadius = (radius: number) => {
    setAlerts((s) => ({ ...s, radius }));
    if (push.enabled) run(() => enablePush(push.types)); // sunucudaki aboneliği yeni yarıçapla güncelle
  };
  const toggleLocal = (on: boolean) =>
    run(async () => {
      if (on && !(await ensureNotificationPermission())) throw new PushUnavailable('Bildirim izni verilmedi.');
      setAlerts((s) => ({ ...s, local: on }));
    });

  // Mahalle araması: hazırlık endeksindeki mahalle listesi (ilçe + mahalle) kullanılır.
  const loadNeighbourhoods = () => {
    if (neighbourhoods) return;
    api
      .layer('hazirlik', { lat: area?.lat ?? 38.4189, lng: area?.lng ?? 27.1287 })
      .then((r) => setNeighbourhoods(r.items))
      .catch(() => setNeighbourhoods([]));
  };
  const matches = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q || !neighbourhoods) return [];
    return neighbourhoods.filter((it) => `${it.mahalle} ${it.ilce}`.toLocaleLowerCase('tr-TR').includes(q)).slice(0, 8);
  }, [search, neighbourhoods]);

  const pazar = Object.entries(reminders.pazar);

  return (
    <ScrollView
      style={{ backgroundColor: theme.sheet }}
      contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.label }]}>Bildirimler</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={[styles.close, { backgroundColor: theme.fill }]} accessibilityLabel="Kapat">
          <SymbolView name={SYM.close} size={12} weight="bold" tintColor={theme.secondary} />
        </Pressable>
      </View>

      {!!message && (
        <View style={[styles.message, { backgroundColor: theme.group }]}>
          <Text style={[styles.body, { color: theme.label, padding: 0 }]}>{message}</Text>
        </View>
      )}

      <Group theme={theme} title="Mahallem">
        <View style={styles.pad}>
          <Text style={[styles.rowTitle, { color: theme.label }]}>{mahallem ? `${mahallem.mahalle}, ${mahallem.ilce}` : 'Seçilmedi'}</Text>
          <Text style={[styles.rowSub, { color: theme.secondary }]}>Kesinti bildirimleri bu mahalleye göre gelir.</Text>
        </View>
        {!!area?.mahalle && (area.mahalle !== mahallem?.mahalle || area.ilce !== mahallem?.ilce) && (
          <RowButton theme={theme} title={`Bulunduğum yer: ${area.mahalle}, ${area.ilce}`} action="Seç" onPress={() => chooseMahalle({ ilce: area.ilce!, mahalle: area.mahalle! })} />
        )}
        <View style={[styles.searchRow, { borderTopColor: theme.separator }]}>
          <SymbolView name={SYM.search} size={14} tintColor={theme.secondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onFocus={loadNeighbourhoods}
            placeholder="Mahalle ara (ör. Kazımdirik)"
            placeholderTextColor={theme.secondary}
            style={[styles.searchInput, { color: theme.label }]}
            autoCorrect={false}
          />
        </View>
        {search.trim() !== '' && neighbourhoods === null && <ActivityIndicator style={{ margin: 10 }} />}
        {matches.map((it) => (
          <RowButton key={it.id} theme={theme} title={`${it.mahalle}, ${it.ilce}`} action="Seç" onPress={() => chooseMahalle({ ilce: it.ilce!, mahalle: it.mahalle! })} />
        ))}
      </Group>

      <Group theme={theme} title="Yakınlık">
        <View style={styles.pad}>
          <SegmentedControl
            values={RADII.map(radiusLabel)}
            selectedIndex={Math.max(0, RADII.findIndex((r) => r === alerts.radius))}
            onChange={(e) => chooseRadius(RADII[e.nativeEvent.selectedSegmentIndex] ?? 0)}
            appearance={theme.scheme}
            enabled={!busy}
          />
          <Text style={[styles.rowSub, { color: theme.secondary, marginTop: 8 }]}>
            {alerts.radius === 0
              ? 'Yalnızca mahallenizdeki kesintiler bildirilir.'
              : `Mahallenizde ve ${alerts.radius} km çevresindeki mahallelerde duyurulan kesintiler bildirilir.`}
          </Text>
        </View>
        <SwitchRow
          theme={theme}
          title="Uygulama açıkken yakınımdakileri bildir"
          sub="Bulunduğunuz yere göre 5 dakikada bir kontrol eder. Expo Go’da da çalışır."
          value={alerts.local}
          disabled={busy}
          onChange={toggleLocal}
        />
      </Group>

      <Group theme={theme} title="Anlık bildirimler (uygulama kapalıyken)">
        {isExpoGo && (
          <Text style={[styles.body, { color: theme.secondary }]}>
            Anlık bildirimler Expo Go’da çalışmaz; uygulamanın TestFlight / App Store sürümünde açılır. Aşağıdaki hatırlatıcılar Expo Go’da da çalışır.
          </Text>
        )}
        <SwitchRow theme={theme} title="Bildirimleri aç" value={push.enabled} disabled={busy || isExpoGo} onChange={togglePush} />
        {TYPE_LABELS.map((t) => (
          <SwitchRow
            key={t.id}
            theme={theme}
            title={t.label}
            sub={t.sub}
            value={push.types.includes(t.id)}
            disabled={busy || isExpoGo}
            onChange={(on) => toggleType(t.id, on)}
          />
        ))}
        {busy && <ActivityIndicator style={{ margin: 10 }} />}
      </Group>

      <Group theme={theme} title="Hatırlatıcılar">
        <SwitchRow
          theme={theme}
          title="Aylık deprem hazırlık kontrolü"
          sub="Her ayın 1’inde: deprem çantası, su ve buluşma noktası"
          value={!!reminders.monthlyPrep}
          disabled={busy}
          onChange={(on) =>
            run(async () => {
              if (!(await setMonthlyPrep(on))) throw new PushUnavailable('Bildirim izni verilmedi.');
            })
          }
        />
        {pazar.length === 0 ? (
          <Text style={[styles.body, { color: theme.secondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
            Pazar hatırlatıcısı eklemek için bir pazarın kartında “Kurulduğu gün hatırlat”a dokunun.
          </Text>
        ) : (
          pazar.map(([id, r]) => (
            <RowButton key={id} theme={theme} title={r.name} sub={`${dayNames(r.days)} · 08:00`} action="Kaldır" onPress={() => run(() => removeMarketReminder(id))} />
          ))
        )}
      </Group>

      <Text style={[styles.footnote, { color: theme.tertiary }]}>
        Anlık bildirim için sunucuya yalnızca cihazınızın bildirim anahtarı ve seçtiğiniz ilçe/mahalle gönderilir; konumunuz gönderilmez.
        Bildirimleri kapattığınızda bu kayıt silinir. Hatırlatıcılar yalnızca telefonunuzda çalışır.
      </Text>
    </ScrollView>
  );
}

function Group({ theme, title, children }: { theme: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.groupWrap}>
      <Text style={[styles.groupTitle, { color: theme.secondary }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.group }]}>{children}</View>
    </View>
  );
}

function SwitchRow({ theme, title, sub, value, disabled, onChange }: { theme: Theme; title: string; sub?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.row, { borderTopColor: theme.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: disabled ? theme.secondary : theme.label }]}>{title}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: theme.secondary }]}>{sub}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

function RowButton({ theme, title, sub, action, onPress }: { theme: Theme; title: string; sub?: string; action: string; onPress: () => void }) {
  return (
    <View style={[styles.row, { borderTopColor: theme.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: theme.secondary }]}>{sub}</Text>}
      </View>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.action, { color: theme.accent }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  message: { marginTop: 14, padding: 12, borderRadius: 12 },
  groupWrap: { marginTop: 24 },
  groupTitle: { fontSize: 13, fontWeight: '600', marginLeft: 4, marginBottom: 6 },
  group: { borderRadius: 12, overflow: 'hidden' },
  pad: { padding: 14 },
  body: { fontSize: 14, lineHeight: 19, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 15.5 },
  rowSub: { fontSize: 12.5, marginTop: 1 },
  action: { fontSize: 15, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 15.5, paddingVertical: 11 },
  footnote: { fontSize: 12, lineHeight: 16, marginTop: 18, marginHorizontal: 4 },
});
