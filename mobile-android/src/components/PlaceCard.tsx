// Seçili yerin kartı: başlık, eylem düğmeleri, bilgiler.
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Item } from '@/lib/api';
import { SYM } from '@/lib/categories';
import type { Theme } from '@/lib/theme';

type Props = {
  item: Item;
  categoryTitle: string;
  theme: Theme;
  routeText: string | null; // gerçek rotadan gelen "2,3 km · 6 dk"
  routeDuration?: string | null; // gerçek rotanın süresi ("6 dk"), yol tarifi düğmesinde
  routePending?: boolean; // gerçek rota henüz gelmedi
  canNavigate?: boolean; // kesintilerde yol tarifi anlamsız
  // Toplanma alanlarında: aile buluşma noktası yap / kaldır
  meeting?: { isThis: boolean; onSet: () => void; onClear: () => void; onShare: () => void };
  favorite?: { on: boolean; onToggle: () => void };
  // Pazar yerlerinde: kurulduğu gün sabah hatırlat
  reminder?: { on: boolean; text: string; onToggle: () => void };
  onClose: () => void;
  onDirections: () => void;
  onCall: () => void;
  onShare: () => void;
};

export function PlaceCard({ item, categoryTitle, theme, routeText, routeDuration, routePending = false, canNavigate = true, meeting, favorite, reminder, onClose, onDirections, onCall, onShare }: Props) {
  const walking = item.mode === 'yuruyus';
  const modeIcon = walking ? SYM.walk : SYM.car;
  const hasRoad = !!routeText || item.distKind === 'yol';
  // Listedeki kayıtta yalnızca kuş uçuşu mesafe varsa, gerçek yol mesafesi gelene kadar onu göstermeyiz.
  const waitingRoad = routePending && !hasRoad;
  const distanceLine =
    routeText ??
    (waitingRoad
      ? null
      : item.distKind === 'yol'
        ? `${item.distText} yol${item.durationText ? ` · ~${item.durationText} ${walking ? 'yürüyerek' : 'araçla'}` : ''}`
        : item.distText
          ? `${item.distText} kuş uçuşu`
          : null);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.label }]}>{item.name}</Text>
          <Text style={[styles.subtitle, { color: theme.secondary }]}>
            {[categoryTitle, item.sub].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={[styles.close, { backgroundColor: theme.fill }]} accessibilityLabel="Kapat">
          <SymbolView name={SYM.close} size={12} weight="bold" tintColor={theme.secondary} />
        </Pressable>
      </View>

      {!!item.badge && (
        <View style={[styles.badge, { backgroundColor: `${item.color}26` }]}>
          <Text style={[styles.badgeText, { color: item.color }]}>{item.badge}</Text>
        </View>
      )}

      <View style={styles.actions}>
        {canNavigate && (
        <Pressable
          onPress={onDirections}
          style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Yol tarifi"
        >
          <SymbolView name={modeIcon} size={17} tintColor="#ffffff" />
          <Text style={styles.primaryText}>{routeDuration ?? item.durationText ?? 'Yol Tarifi'}</Text>
        </Pressable>
        )}
        {!!item.phone && (
          <ActionButton label="Ara" symbol={SYM.phone} onPress={onCall} theme={theme} />
        )}
        {!!favorite && (
          <ActionButton
            label={favorite.on ? 'Favoride' : 'Favori'}
            symbol={favorite.on ? SYM.starFill : SYM.star}
            onPress={favorite.onToggle}
            theme={theme}
          />
        )}
        <ActionButton label="Paylaş" symbol={SYM.share} onPress={onShare} theme={theme} />
      </View>

      {canNavigate && waitingRoad && (
        <View style={styles.distance}>
          <ActivityIndicator size="small" color={theme.secondary} style={styles.pendingSpinner} />
          <Text style={[styles.distanceText, { color: theme.secondary }]}>Yol mesafesi hesaplanıyor…</Text>
        </View>
      )}

      {canNavigate && !!distanceLine && (
        <View style={styles.distance}>
          <SymbolView name={hasRoad ? modeIcon : SYM.ruler} size={13} tintColor={theme.secondary} />
          <Text style={[styles.distanceText, { color: theme.secondary }]}>
            {distanceLine} <Text style={{ color: theme.tertiary }}>(trafiksiz)</Text>
          </Text>
        </View>
      )}

      {!!meeting && (
        <View style={[styles.meeting, { backgroundColor: theme.group }]}>
          {meeting.isThis ? (
            <>
              <View style={styles.meetingHead}>
                <SymbolView name={SYM.flag} size={15} tintColor="#34c759" />
                <Text style={[styles.meetingTitle, { color: theme.label }]}>Aile buluşma noktanız</Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Aileyle paylaş" symbol={SYM.share} onPress={meeting.onShare} theme={theme} />
                <ActionButton label="Kaldır" symbol={SYM.trash} onPress={meeting.onClear} theme={theme} />
              </View>
            </>
          ) : (
            <Pressable
              onPress={meeting.onSet}
              style={({ pressed }) => [styles.meetingSet, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
            >
              <SymbolView name={SYM.flag} size={16} tintColor="#34c759" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.meetingTitle, { color: theme.label }]}>Aile buluşma noktası yap</Text>
                <Text style={[styles.meetingSub, { color: theme.secondary }]}>Deprem sonrası ailenizle burada buluşun</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      {!!reminder && (
        <Pressable
          onPress={reminder.onToggle}
          style={({ pressed }) => [styles.meeting, styles.meetingSet, { backgroundColor: theme.group, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: reminder.on }}
        >
          <SymbolView name={SYM.bell} size={16} tintColor={reminder.on ? theme.orange : theme.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.meetingTitle, { color: theme.label }]}>
              {reminder.on ? 'Hatırlatıcı açık' : 'Kurulduğu gün hatırlat'}
            </Text>
            <Text style={[styles.meetingSub, { color: theme.secondary }]}>{reminder.text}</Text>
          </View>
          <Text style={[styles.secondaryText, { color: theme.accent }]}>{reminder.on ? 'Kapat' : 'Aç'}</Text>
        </Pressable>
      )}

      {item.details.length > 0 && (
        <View style={[styles.group, { backgroundColor: theme.group }]}>
          {item.details.map(([k, v], i) => (
            <View key={k} style={[styles.detail, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
              <Text style={[styles.detailKey, { color: theme.secondary }]}>{k}</Text>
              <Text style={[styles.detailValue, { color: theme.label }]} selectable>
                {v}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ActionButton({ label, symbol, onPress, theme }: { label: string; symbol: (typeof SYM)[keyof typeof SYM]; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, { backgroundColor: theme.fill, opacity: pressed ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <SymbolView name={symbol} size={16} tintColor={theme.accent} />
      <Text style={[styles.secondaryText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, marginTop: 2 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  badge: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 12.5, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  primary: { flex: 1.4, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 2 },
  primaryText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  secondary: { flex: 1, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 2 },
  secondaryText: { fontSize: 12.5, fontWeight: '600' },
  distance: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  distanceText: { fontSize: 13.5 },
  pendingSpinner: { transform: [{ scale: 0.7 }], width: 13, height: 13 },
  group: { marginTop: 14, borderRadius: 12, overflow: 'hidden' },
  meeting: { marginTop: 14, borderRadius: 12, padding: 12 },
  meetingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetingSet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meetingTitle: { fontSize: 15, fontWeight: '600' },
  meetingSub: { fontSize: 12.5, marginTop: 1 },
  detail: { paddingHorizontal: 14, paddingVertical: 10 },
  detailKey: { fontSize: 12.5 },
  detailValue: { fontSize: 15, marginTop: 1 },
});
