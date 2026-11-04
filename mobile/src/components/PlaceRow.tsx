// Liste satırları: yer satırı (eczane, otopark...), "Yakınımda" satırı ve su kesintisi satırı.
import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Item, NearbyResult } from '@/lib/api';
import { SYM, type SymbolName } from '@/lib/categories';
import type { Theme } from '@/lib/theme';

export const Separator = memo(function Separator({ theme }: { theme: Theme }) {
  return <View style={[styles.separator, { backgroundColor: theme.separator }]} />;
});

type PlaceRowProps = { item: Item; symbol: SymbolName; selected?: boolean; onPress: (item: Item) => void; theme: Theme };

export const PlaceRow = memo(function PlaceRow({ item, symbol, selected, onPress, theme }: PlaceRowProps) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: theme.selection }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.distText ?? ''}`}
    >
      <View style={[styles.icon, { backgroundColor: item.color }]}>
        <SymbolView name={symbol} size={15} tintColor="#ffffff" />
      </View>
      <View style={styles.main}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.label }]}>
          {item.name}
        </Text>
        {!!item.sub && (
          <Text numberOfLines={1} style={[styles.sub, { color: theme.secondary }]}>
            {item.sub}
          </Text>
        )}
      </View>
      <View style={styles.side}>
        {!!item.distText && (
          <Text style={[styles.dist, { color: item.distKind === 'yol' ? theme.label : theme.secondary }]}>
            {item.distKind === 'yol' ? item.distText : `≈ ${item.distText}`}
          </Text>
        )}
        {!!item.durationText && (
          <View style={styles.duration}>
            <SymbolView name={item.mode === 'yuruyus' ? SYM.walk : SYM.car} size={10} tintColor={theme.secondary} />
            <Text style={[styles.small, { color: theme.secondary }]}>{item.durationText}</Text>
          </View>
        )}
        {!!item.badge && (
          <View style={[styles.badge, { backgroundColor: `${item.color}26` }]}>
            <Text style={[styles.badgeText, { color: item.color }]}>{item.badge}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

type NearbyRowProps = {
  label: string;
  symbol: SymbolName;
  color: string;
  result?: NearbyResult | { error: string };
  onPress: () => void;
  theme: Theme;
};

export const NearbyRow = memo(function NearbyRow({ label, symbol, color, result, onPress, theme }: NearbyRowProps) {
  const error = result && 'error' in result ? result.error : null;
  const r = result && !('error' in result) ? result : null;
  const mainColor = error || r?.cls === 'err' ? theme.red : r?.cls === 'warn' ? theme.orange : r?.cls === 'muted' ? theme.secondary : theme.label;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.selection }]} accessibilityRole="button">
      <View style={[styles.square, { backgroundColor: color }]}>
        <SymbolView name={symbol} size={16} tintColor="#ffffff" />
      </View>
      <View style={styles.main}>
        <Text numberOfLines={1} style={[styles.small, { color: theme.secondary }]}>
          {label}
        </Text>
        {result ? (
          <Text numberOfLines={2} style={[styles.title, { color: mainColor }]}>
            {error ? 'Servis şu anda yanıt vermiyor' : r?.main}
          </Text>
        ) : (
          <ActivityIndicator style={styles.loading} size="small" />
        )}
        {!!r?.sub && (
          <Text numberOfLines={2} style={[styles.sub, { color: theme.secondary }]}>
            {r.sub}
          </Text>
        )}
      </View>
      <SymbolView name={SYM.chevron} size={13} tintColor={theme.tertiary} />
    </Pressable>
  );
});

// Hal fiyatı satırı: ürün, tür ve ortalama fiyat; altında en düşük – en yüksek.
export const PriceRow = memo(function PriceRow({ item, theme }: { item: Item; theme: Theme }) {
  const p = item.price!;
  const unit = p.unit ? ` / ${p.unit.toLocaleLowerCase('tr-TR')}` : '';
  return (
    <View style={[styles.row, styles.priceRow, { borderBottomColor: theme.separator }]} accessible accessibilityLabel={`${item.name}, ortalama ${p.avg}${unit}`}>
      <View style={styles.main}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.label }]}>
          {item.name}
        </Text>
        <Text style={[styles.sub, { color: theme.secondary }]}>{item.kind}</Text>
      </View>
      <View style={styles.side}>
        <Text style={[styles.dist, { color: theme.label }]}>
          {p.avg ?? '—'}
          <Text style={[styles.small, { color: theme.secondary, fontWeight: '400' }]}>{unit}</Text>
        </Text>
        {!!p.min && !!p.max && p.min !== p.max && (
          <Text style={[styles.small, { color: theme.secondary, fontVariant: ['tabular-nums'] }]}>
            {p.min} – {p.max}
          </Text>
        )}
      </View>
    </View>
  );
});

type OutageRowProps = { item: Item; theme: Theme; selected?: boolean; onPress?: (item: Item) => void };

export const OutageRow = memo(function OutageRow({ item, theme, selected, onPress }: OutageRowProps) {
  const kindColor = item.color || (item.kind === 'Planlı' ? '#5856d6' : theme.orange);
  const onMap = item.lat != null;
  return (
    <Pressable
      disabled={!onMap || !onPress}
      onPress={() => onPress?.(item)}
      style={({ pressed }) => [
        styles.outage,
        { backgroundColor: pressed ? theme.selection : theme.group },
        selected && { borderWidth: 2, borderColor: theme.accent },
      ]}
      accessibilityRole={onMap ? 'button' : undefined}
    >
      <View style={styles.outageTop}>
        <Text style={[styles.title, { color: theme.label, flex: 1 }]}>{item.ilce || 'İlçe belirtilmemiş'}</Text>
        {!!item.distText && <Text style={[styles.small, { color: theme.secondary }]}>≈ {item.distText}</Text>}
        {!!item.kind && (
          <View style={[styles.badge, { backgroundColor: `${kindColor}26` }]}>
            <Text style={[styles.badgeText, { color: kindColor }]}>{item.kind}</Text>
          </View>
        )}
      </View>
      {!!item.mahalle && <Text style={[styles.sub, { color: theme.secondary }]}>{item.mahalle}</Text>}
      {!!item.reason && <Text style={[styles.reason, { color: theme.label }]}>{item.reason}</Text>}
      {!!item.description && <Text style={[styles.body, { color: theme.label }]}>{item.description}</Text>}
      {!!item.duration && (
        <View style={styles.meta}>
          <SymbolView name={SYM.clock} size={12} tintColor={theme.secondary} />
          <Text style={[styles.small, { color: theme.secondary, flex: 1 }]}>{item.duration}</Text>
        </View>
      )}
      {!!item.subscribers && (
        <View style={styles.meta}>
          <SymbolView name={SYM.people} size={12} tintColor={theme.secondary} />
          <Text style={[styles.small, { color: theme.secondary }]}>
            {item.subscribers.toLocaleString('tr-TR')} abone{item.company ? ` · ${item.company}` : ''}
          </Text>
        </View>
      )}
      {!onMap && <Text style={[styles.small, { color: theme.tertiary, marginTop: 6 }]}>Haritada gösterilemiyor</Text>}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  square: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  sub: { fontSize: 13.5, marginTop: 1 },
  small: { fontSize: 12.5 },
  body: { fontSize: 14, marginTop: 6 },
  side: { alignItems: 'flex-end', gap: 3 },
  dist: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  duration: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  badge: { paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 999 },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  priceRow: { borderBottomWidth: StyleSheet.hairlineWidth, marginLeft: 16, paddingLeft: 0 },
  loading: { alignSelf: 'flex-start', marginVertical: 4 },
  outage: { marginHorizontal: 16, marginVertical: 5, padding: 14, borderRadius: 12 },
  outageTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reason: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
});
