// Aile buluşma noktası: "Deprem olursa şu toplanma alanında buluşalım."
// Yalnızca telefonda saklanır; mesafe cihazda hesaplanır (internet yokken de çalışır).
import { SymbolView } from 'expo-symbols';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { SYM } from '@/lib/categories';
import { fmtDist, haversine, walkMinutes, type Point } from '@/lib/geo';
import type { MeetingPoint } from '@/lib/persistent';
import type { Theme } from '@/lib/theme';

export const MEETING_COLOR = '#34c759';

export function shareMeetingPoint(p: MeetingPoint) {
  const link = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return Share.share({
    message:
      `Deprem ya da acil bir durumda telefonlar çalışmazsa şurada buluşalım:\n` +
      `${p.name}${p.sub ? ` (${p.sub})` : ''}\n${link}\n\nAcil durumda 112.`,
  });
}

export function openWalkingDirections(p: Point) {
  return Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`);
}

type Props = { point: MeetingPoint | null; from: Point; theme: Theme; onPick: () => void; onOpen: () => void };

export function MeetingCard({ point, from, theme, onPick, onOpen }: Props) {
  if (!point) {
    return (
      <Pressable
        onPress={onPick}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.group, opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
      >
        <View style={[styles.icon, { backgroundColor: MEETING_COLOR }]}>
          <SymbolView name={SYM.flag} size={16} tintColor="#ffffff" />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: theme.label }]}>Aile buluşma noktanızı belirleyin</Text>
          <Text style={[styles.sub, { color: theme.secondary }]}>
            Deprem sonrası telefonlar çalışmayabilir. Bir toplanma alanı seçip ailenizle paylaşın.
          </Text>
        </View>
        <SymbolView name={SYM.chevron} size={13} tintColor={theme.tertiary} />
      </Pressable>
    );
  }

  const d = haversine(from, point);
  return (
    <View style={[styles.card, styles.column, { backgroundColor: theme.group }]}>
      <Pressable onPress={onOpen} style={styles.row} accessibilityRole="button" accessibilityLabel={`Buluşma noktası: ${point.name}`}>
        <View style={[styles.icon, { backgroundColor: MEETING_COLOR }]}>
          <SymbolView name={SYM.flag} size={16} tintColor="#ffffff" />
        </View>
        <View style={styles.body}>
          <Text style={[styles.label, { color: theme.secondary }]}>Aile buluşma noktanız</Text>
          <Text style={[styles.title, { color: theme.label }]} numberOfLines={2}>
            {point.name}
          </Text>
          <Text style={[styles.sub, { color: theme.secondary }]}>
            {[point.sub, `${fmtDist(d)} · ~${walkMinutes(d)} dk yürüyerek`].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          onPress={() => openWalkingDirections(point)}
          style={({ pressed }) => [styles.btn, { backgroundColor: MEETING_COLOR, opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
        >
          <SymbolView name={SYM.walk} size={15} tintColor="#ffffff" />
          <Text style={styles.btnTextLight}>Yol tarifi</Text>
        </Pressable>
        <Pressable
          onPress={() => shareMeetingPoint(point)}
          style={({ pressed }) => [styles.btn, { backgroundColor: theme.fill, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
        >
          <SymbolView name={SYM.share} size={15} tintColor={theme.accent} />
          <Text style={[styles.btnText, { color: theme.accent }]}>Aileyle paylaş</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 12 },
  title: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2 },
  sub: { fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 10 },
  btnText: { fontSize: 14, fontWeight: '600' },
  btnTextLight: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
});
