// iOS sistem renkleri (açık / koyu). Tema, telefonun görünüm ayarını izler.
import { useColorScheme } from 'react-native';

const light = {
  scheme: 'light' as 'light' | 'dark',
  sheet: '#f9f9f9',
  group: '#ffffff',
  label: '#000000',
  secondary: 'rgba(60,60,67,0.6)',
  tertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.2)',
  fill: 'rgba(118,118,128,0.12)',
  selection: 'rgba(0,122,255,0.1)',
  accent: '#007aff',
  red: '#ff3b30',
  orange: '#ff9500',
  green: '#34c759',
  floating: 'rgba(255,255,255,0.94)',
  routeCasing: '#0a5ac2',
  toast: 'rgba(30,30,32,0.92)',
};

const dark: typeof light = {
  scheme: 'dark',
  sheet: '#1c1c1e',
  group: '#2c2c2e',
  label: '#ffffff',
  secondary: 'rgba(235,235,245,0.6)',
  tertiary: 'rgba(235,235,245,0.3)',
  separator: 'rgba(84,84,88,0.65)',
  fill: 'rgba(118,118,128,0.24)',
  selection: 'rgba(10,132,255,0.22)',
  accent: '#0a84ff',
  red: '#ff453a',
  orange: '#ff9f0a',
  green: '#30d158',
  floating: 'rgba(44,44,46,0.94)',
  routeCasing: '#063f8c',
  toast: 'rgba(58,58,60,0.95)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
