// "Araçla / Yürüyerek" seçimi: simgeli, iOS seçim çubuğu görünümünde küçük bir düğme çifti.
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TravelMode } from '@/lib/api';
import { SYM, type SymbolName } from '@/lib/categories';
import type { Theme } from '@/lib/theme';

const OPTIONS: { id: TravelMode; label: string; symbol: SymbolName }[] = [
  { id: 'arac', label: 'Araçla', symbol: SYM.car },
  { id: 'yuruyus', label: 'Yürüyerek', symbol: SYM.walk },
];

export function ModeToggle({ value, onChange, theme }: { value: TravelMode; onChange: (m: TravelMode) => void; theme: Theme }) {
  return (
    <View style={[styles.wrap, { backgroundColor: theme.fill }]} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(o.id);
            }}
            style={[styles.item, on && [styles.on, { backgroundColor: theme.scheme === 'dark' ? '#636366' : '#ffffff' }]]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <SymbolView name={o.symbol} size={13} tintColor={on ? theme.accent : theme.secondary} />
            <Text style={[styles.label, { color: on ? theme.label : theme.secondary, fontWeight: on ? '600' : '500' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', padding: 2, borderRadius: 9, alignSelf: 'flex-start' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  on: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  label: { fontSize: 13 },
});
