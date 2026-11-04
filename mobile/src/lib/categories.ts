// Kategori simgeleri: iOS'ta SF Symbols, Android'de Material Symbols.
import type { SymbolViewProps } from 'expo-symbols';

export type SymbolName = SymbolViewProps['name'];

export const OVERVIEW_ID = 'yakinimda';
export const OVERVIEW_COLOR = '#007aff';

const SYMBOLS: Record<string, SymbolName> = {
  yakinimda: { ios: 'location.fill', android: 'near_me' },
  eczane: { ios: 'cross.case.fill', android: 'local_pharmacy' },
  saglik: { ios: 'stethoscope', android: 'local_hospital' },
  toplanma: { ios: 'person.3.fill', android: 'groups' },
  deprem: { ios: 'waveform.path.ecg', android: 'earthquake' },
  hazirlik: { ios: 'checkmark.shield.fill', android: 'health_and_safety' },
  otopark: { ios: 'parkingsign', android: 'local_parking' },
  taksi: { ios: 'car.fill', android: 'local_taxi' },
  pazar: { ios: 'basket.fill', android: 'shopping_basket' },
  hal: { ios: 'carrot.fill', android: 'nutrition' },
  deniz: { ios: 'water.waves', android: 'pool' },
  wifi: { ios: 'wifi', android: 'wifi' },
  su: { ios: 'drop.fill', android: 'water_drop' },
  elektrik: { ios: 'bolt.fill', android: 'bolt' },
  hava: { ios: 'wind', android: 'air' },
};

// Kategori düğmelerinin altındaki kısa adlar
const SHORT: Record<string, string> = {
  yakinimda: 'Yakınımda',
  eczane: 'Eczane',
  saglik: 'Sağlık',
  toplanma: 'Toplanma',
  deprem: 'Deprem',
  hazirlik: 'Hazırlık',
  otopark: 'Otopark',
  taksi: 'Taksi',
  pazar: 'Pazar',
  hal: 'Hal',
  deniz: 'Deniz',
  wifi: 'Wi-Fi',
  su: 'Su',
  elektrik: 'Elektrik',
  hava: 'Hava',
};

export const symbolFor = (id: string): SymbolName => SYMBOLS[id] ?? { ios: 'mappin', android: 'place' };
export const shortTitle = (id: string, fallback: string) => SHORT[id] ?? fallback;

export const SYM = {
  close: { ios: 'xmark', android: 'close' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  search: { ios: 'magnifyingglass', android: 'search' },
  car: { ios: 'car.fill', android: 'directions_car' },
  walk: { ios: 'figure.walk', android: 'directions_walk' },
  flag: { ios: 'flag.fill', android: 'flag' },
  trash: { ios: 'trash', android: 'delete' },
  phone: { ios: 'phone.fill', android: 'call' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  locate: { ios: 'location.fill', android: 'my_location' },
  locateOff: { ios: 'location', android: 'location_searching' },
  map: { ios: 'map.fill', android: 'map' },
  globe: { ios: 'globe.europe.africa.fill', android: 'public' },
  ruler: { ios: 'ruler', android: 'straighten' },
  clock: { ios: 'clock.fill', android: 'schedule' },
  people: { ios: 'person.2.fill', android: 'group' },
  pin: { ios: 'mappin.and.ellipse', android: 'pin_drop' },
  info: { ios: 'info.circle', android: 'info' },
  lock: { ios: 'hand.raised.fill', android: 'privacy_tip' },
  doc: { ios: 'doc.text', android: 'description' },
  external: { ios: 'arrow.up.right', android: 'open_in_new' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  star: { ios: 'star', android: 'star_border' },
  starFill: { ios: 'star.fill', android: 'star' },
  home: { ios: 'house.fill', android: 'home' },
} satisfies Record<string, SymbolName>;
