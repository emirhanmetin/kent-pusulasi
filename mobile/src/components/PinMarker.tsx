// Harita işareti: Apple Haritalar tarzı yuvarlak POI; seçilince altında uç olan büyük balon.
import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { SymbolName } from '@/lib/categories';

type Props = {
  lat: number;
  lng: number;
  color: string;
  symbol: SymbolName;
  title?: string;
  selected?: boolean;
  large?: boolean;
  onPress?: () => void;
};

function PinMarkerBase({ lat, lng, color, symbol, title, selected = false, large = false, onPress }: Props) {
  // Özel görünümlü işaretler her karede yeniden çizilmesin diye kısa süre sonra "donduruluyor";
  // simgenin (SF Symbol) yüklenmesine zaman tanımak için ilk anlarda izleme açık.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(t);
  }, []);

  const size = selected ? 44 : large ? 34 : 26;
  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      onPress={onPress}
      tracksViewChanges={tracks}
      anchor={selected ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
      zIndex={selected ? 100 : large ? 10 : 1}
      accessibilityLabel={title}
    >
      <View style={styles.wrap}>
        <View
          style={[
            styles.circle,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: selected ? 3 : 2 },
          ]}
        >
          <SymbolView name={symbol} size={selected ? 21 : large ? 16 : 12} tintColor="#ffffff" />
        </View>
        {selected && <View style={styles.tail} />}
      </View>
    </Marker>
  );
}

export const PinMarker = memo(PinMarkerBase);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
  },
});
