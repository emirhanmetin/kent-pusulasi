// Python backend'inin (backend/main.py) istemcisi. Veri, filtreleme, mesafe ve rota hesabı sunucuda.
import Constants from 'expo-constants';

/**
 * Sunucu adresi:
 * - EXPO_PUBLIC_API_URL tanımlıysa o (ör. internete açılmış sunucu),
 * - yoksa Expo geliştirme sunucusunun çalıştığı bilgisayarın yerel ağ IP'si + 8000 portu.
 *   iPhone ile bilgisayar aynı Wi-Fi'da olmalı ve sunucu `python serve.py --lan` ile başlatılmalı.
 */
function resolveBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (__DEV__) {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    return host ? `http://${host}:8000` : 'http://localhost:8000';
  }
  // Yayın derlemesinde adres zorunludur (eas.json › build › production › env › EXPO_PUBLIC_API_URL).
  return '';
}

export const API_BASE = resolveBase();

/** Sunucunun yayınladığı web sayfaları (gizlilik politikası, kaynaklar). */
export const webUrl = (path: string) => `${API_BASE}/${path.replace(/^\//, '')}`;

export type LatLngPoint = { lat: number; lng: number };
export type TravelMode = 'arac' | 'yuruyus';

export type LayerMeta = {
  id: string;
  group: string;
  title: string;
  navTitle: string;
  icon: string[];
  color: string;
  intro: string;
  cluster: boolean;
  slow: boolean;
  noMap: boolean;
  outage: boolean; // kesinti listesi: etkilenen mahalleler haritada renkli dairelerle
  areaCircles: boolean; // her kaydın yerinde renkli daire (hazırlık endeksi)
  search: boolean;
  searchPlaceholder: string;
  emptyText: string;
  errorText: string;
  errorLink: { href: string; label: string } | null;
  directions: string;
  routing: boolean;
  defaultMode: TravelMode;
};

export type Item = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  sub: string;
  color: string;
  badge: string | null;
  details: [string, string][];
  phone: string | null;
  dist?: number;
  distText?: string;
  distKind?: 'yol' | 'kus';
  mode?: TravelMode;
  durationText?: string | null;
  // Su / elektrik kesintisi kayıtları (haritasız)
  kind?: 'Arıza' | 'Planlı' | null;
  subscribers?: number | null;
  company?: string | null;
  start?: string | null;
  areas?: { name: string; lat: number; lng: number }[];
  days?: number[]; // pazar yerleri: kurulduğu günler (0 = Pazartesi)
  price?: { min: string | null; max: string | null; avg: string | null; unit: string }; // hal fiyatları (biçimlenmiş)
  ilce?: string | null;
  mahalle?: string | null;
  reason?: string | null;
  duration?: string | null;
  description?: string | null;
  end?: string | null;
};

export type LayerResponse = {
  mesafe: { tur: 'yol' | 'kus'; yolSayisi: number; adaySayisi: number; hata: string | null; mod: TravelMode };
  durum: { guncellendi: number; guncellendiMetin: string; eski: boolean; hata: string | null; damga: string | null };
  filtreler: { id: string; label: string }[];
  filtre: string | null;
  toplam: number;
  items: Item[];
};

export type NearbyCard = { id: string; layer: string; label: string };
export type NearbyResult = { main: string; sub: string; cls: '' | 'muted' | 'err' | 'warn'; item: Item | null };
export type RouteResult = { mesafe: number; sure: number; koordinatlar: [number, number][]; mesafeMetin: string; sureMetin: string };
export type IpLocation = { lat: number; lng: number; accuracy: number; sehir: string; izmirde: boolean; source: 'ip' };
export type Area = { mahalle: string | null; ilce: string | null; izmirde: boolean };

type Params = Record<string, string | number | undefined | null>;

function get<T>(path: string, params: Params = {}, timeoutMs = 60000): Promise<T> {
  return request<T>('GET', path, params, undefined, timeoutMs);
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, body?: unknown, timeoutMs = 60000): Promise<T> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  if (!API_BASE) throw new Error('Sunucu adresi yapılandırılmamış (EXPO_PUBLIC_API_URL).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ''}`, {
      method,
      signal: ctrl.signal,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new Error(
      (e as Error).name === 'AbortError'
        ? 'Sunucu zamanında yanıt vermedi.'
        : `Sunucuya ulaşılamadı (${API_BASE}). Bilgisayarda "python serve.py --lan" çalışıyor ve iPhone aynı Wi-Fi'da mı?`,
    );
  } finally {
    clearTimeout(timer);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.detail?.hata ?? `HTTP ${res.status}`);
  return payload as T;
}

export const api = {
  layers: () => get<LayerMeta[]>('/api/katmanlar'),
  layer: (id: string, p: { lat: number; lng: number; filtre?: string; q?: string; mod?: TravelMode }) =>
    get<LayerResponse>(`/api/katman/${id}`, p),
  nearbyCards: () => get<NearbyCard[]>('/api/yakinimda'),
  nearby: (cardId: string, p: LatLngPoint) => get<NearbyResult>(`/api/yakinimda/${cardId}`, p),
  route: (from: LatLngPoint, to: LatLngPoint, mod: TravelMode = 'arac') =>
    get<RouteResult>('/api/rota', { lat: from.lat, lng: from.lng, hlat: to.lat, hlng: to.lng, mod }, 20000),
  ipLocation: () => get<IpLocation>('/api/konum/ip', {}, 15000),
  offlinePack: () => get<{ surum: number; toplanma: unknown[] }>('/api/cevrimdisi', {}, 30000),
  area: (p: LatLngPoint) => get<Area>('/api/konum/bolge', p, 20000),
  subscribe: (b: { token: string; ilce: string | null; mahalle: string | null; turler: string[]; yaricap: number }) =>
    request<{ tamam: boolean }>('POST', '/api/bildirim/abone', {}, b, 20000),
  unsubscribe: (token: string) => request<{ tamam: boolean }>('DELETE', '/api/bildirim/abone', { token }, undefined, 20000),
};
