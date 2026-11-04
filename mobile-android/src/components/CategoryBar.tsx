// Yatay kategori şeridi.
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { symbolFor } from '@/lib/categories';
import type { Theme } from '@/lib/theme';

export type Category = { id: string; title: string; color: string };

type Props = { categories: Category[]; active: string; onSelect: (id: string) => void; theme: Theme };

export function CategoryBar({ categories, active, onSelect, theme }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {categories.map((c) => {
        const on = c.id === active;
        return (
          <Pressable
            key={c.id}
            onPress={() => onSelect(c.id)}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.title}
          >
            <View style={[styles.ring, { borderColor: on ? c.color : 'transparent' }]}>
              <View style={[styles.circle, { backgroundColor: c.color }]}>
                <SymbolView name={symbolFor(c.id)} size={20} tintColor="#ffffff" />
              </View>
            </View>
            <Text numberOfLines={2} style={[styles.label, { color: on ? theme.label : theme.secondary, fontWeight: on ? '600' : '500' }]}>
              {c.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, gap: 6, paddingVertical: 4 },
  item: { width: 70, alignItems: 'center', gap: 4 },
  ring: { borderWidth: 2.5, borderRadius: 30, padding: 2 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11.5, lineHeight: 14, textAlign: 'center' },
});
