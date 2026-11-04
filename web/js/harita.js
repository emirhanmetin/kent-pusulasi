// Harita altlığı, açık/koyu tema ve "Harita" menüsü.
//
// Standart altlık OpenFreeMap'in "liberty" vektör stilinden türetilir: stil JSON'u yüklenmeden önce
// katmanlar Apple Haritalar'a benzer bir paletle yeniden boyanır, dükkan simgeleri gibi kalabalık
// katmanlar atılır ve küçük yazılar (mahalle, sokak adı) yalnızca yakın zoomda gösterilir.
// WebGL yoksa OSM raster altlığına düşülür.

import { icon, prefs } from './util.js';

const BASE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ATTR_OFM =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ATTR_ESRI = 'Görüntü © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics';
const ATTR_DATA = 'Veri: <a href="https://acikveri.bizizmir.com/" target="_blank" rel="noopener">İzBB</a> (CC BY 4.0)';

/* ---------- Apple Haritalar benzeri paletler ---------- */

const PALETTES = {
  light: {
    land: '#f6f4ef',
    water: '#a9d6f5',
    waterLabel: '#3f7fb3',
    park: '#cfeac0',
    wood: '#c3e4b1',
    cemetery: '#dbe8d2',
    hospital: '#fbe1e3',
    school: '#f6ecd5',
    sand: '#f3ead3',
    aeroway: '#e6e6ec',
    building: '#e9e7e2',
    buildingOutline: '#dcd9d2',
    minor: '#ffffff',
    minorCasing: '#e2ded6',
    secondary: '#ffffff',
    secondaryCasing: '#d9d3c7',
    primary: '#fff4c9',
    primaryCasing: '#e5d49a',
    motorway: '#f9cd6b',
    motorwayCasing: '#e0a93f',
    path: '#ffffff',
    rail: '#d2d0cb',
    boundary: '#bdb7cc',
    label: '#1c1c1e',
    labelMinor: '#6c6c70',
    halo: '#f6f4ef',
  },
  dark: {
    land: '#26272b',
    water: '#1b3048',
    waterLabel: '#6f9ccb',
    park: '#23392b',
    wood: '#213629',
    cemetery: '#2a342c',
    hospital: '#3a2b2f',
    school: '#383328',
    sand: '#34312a',
    aeroway: '#303136',
    building: '#333439',
    buildingOutline: '#3d3e44',
    minor: '#424349',
    minorCasing: '#2d2e32',
    secondary: '#4d4e55',
    secondaryCasing: '#313236',
    primary: '#5d5a52',
    primaryCasing: '#3a3833',
    motorway: '#8f6d35',
    motorwayCasing: '#5f4a27',
    path: '#3c3d42',
    rail: '#45464c',
    boundary: '#5b5870',
    label: '#f2f2f7',
    labelMinor: '#a1a1a6',
    halo: '#26272b',
  },
};

// Bu zoomun altında yazı gösterilmez (uzaktan bakınca harita yazısız ve sade kalsın).
const LABEL_MIN_ZOOM = {
  label_other: 15, // mahalle / semt adları
  label_village: 14,
  'highway-name-major': 15,
  'highway-name-minor': 16,
  'highway-name-path': 17,
  water_name_line_label: 14,
  airport: 13,
};

// Tamamen atılan katmanlar: dükkan/ATM simgeleri, tek yön okları, 3B binalar, ilçe sınırları, yol kalkanları...
const DROP = /^poi|one_way|building-3d|road_area_pattern|natural_earth|boundary_3|boundary_disputed|shield|hatching|park_outline/;

function roadColor(id, p) {
  const casing = id.includes('casing');
  if (/path|pedestrian/.test(id)) return casing ? p.minorCasing : p.path;
  const cls = /motorway/.test(id) ? 'motorway' : /trunk_primary/.test(id) ? 'primary' : /secondary_tertiary/.test(id) ? 'secondary' : 'minor';
  return casing ? p[`${cls}Casing`] : p[cls];
}

function fillColor(id, p) {
  if (id === 'water') return p.water;
  if (id === 'building') return p.building;
  if (/cemetery/.test(id)) return p.cemetery;
  if (/wood/.test(id)) return p.wood;
  if (/park|grass|wetland|pitch|track/.test(id)) return p.park;
  if (/hospital/.test(id)) return p.hospital;
  if (/school/.test(id)) return p.school;
  if (/sand/.test(id)) return p.sand;
  if (/aeroway/.test(id)) return p.aeroway;
  return p.land; // yerleşim, buz vb. zeminle aynı
}

function recolor(layer, p) {
  const l = { ...layer, paint: { ...(layer.paint ?? {}) }, layout: { ...(layer.layout ?? {}) } };
  const id = l.id;
  const set = (k, v) => (l.paint[k] = v);
  switch (l.type) {
    case 'background':
      set('background-color', p.land);
      break;
    case 'fill':
      delete l.paint['fill-pattern'];
      set('fill-color', fillColor(id, p));
      if (id === 'building') {
        set('fill-outline-color', p.buildingOutline);
        set('fill-opacity', ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1]);
      } else {
        set('fill-opacity', 1);
      }
      break;
    case 'line':
      if (/^waterway/.test(id)) set('line-color', p.water);
      else if (/rail/.test(id)) set('line-color', p.rail);
      else if (/^boundary/.test(id)) set('line-color', p.boundary);
      else if (/aeroway/.test(id)) set('line-color', p.aeroway);
      else if (/^(road|bridge|tunnel)_/.test(id)) {
        set('line-color', roadColor(id, p));
        if (id.startsWith('tunnel')) set('line-opacity', 0.5);
      }
      break;
    case 'symbol': {
      if (l.layout['text-field'] == null) return null; // yalnızca simge olan katmanlar
      delete l.layout['icon-image'];
      const major = /label_(city|town|state|country)/.test(id);
      set('text-color', id.startsWith('water') ? p.waterLabel : major ? p.label : p.labelMinor);
      set('text-halo-color', p.halo);
      set('text-halo-width', 1.4);
      set('text-halo-blur', 0.4);
      if (LABEL_MIN_ZOOM[id]) l.minzoom = Math.max(l.minzoom ?? 0, LABEL_MIN_ZOOM[id]);
      break;
    }
    case 'fill-extrusion':
    case 'raster':
      return null;
    default:
      break;
  }
  return l;
}

let baseStylePromise = null;
const styleCache = new Map();

async function appleStyle(theme) {
  if (styleCache.has(theme)) return styleCache.get(theme);
  baseStylePromise ??= fetch(BASE_STYLE).then((r) => {
    if (!r.ok) throw new Error(`stil yüklenemedi (HTTP ${r.status})`);
    return r.json();
  });
  const base = await baseStylePromise;
  const p = PALETTES[theme];
  const style = { ...base, layers: base.layers.filter((l) => !DROP.test(l.id)).map((l) => recolor(l, p)).filter(Boolean) };
  styleCache.set(theme, style);
  return style;
}

const hasWebGL = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
})();

async function createLayer(mode, theme) {
  if (mode === 'uydu') {
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      maxNativeZoom: 18,
      attribution: ATTR_ESRI,
    });
  }
  if (!hasWebGL || !L.maplibreGL) throw new Error('WebGL yok');
  const style = await appleStyle(theme);
  // Sabit kaynak yazısı: eklenti aksi halde yazıyı stilden sonradan topluyor ve altlık değişince eskisi silinmiyor.
  return L.maplibreGL({ style, attributionControl: { customAttribution: ATTR_OFM }, interactive: false });
}

/* ---------- Tema ---------- */

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const THEMES = [
  { id: 'auto', label: 'Otomatik' },
  { id: 'light', label: 'Açık' },
  { id: 'dark', label: 'Koyu' },
];
const MODES = [
  { id: 'standart', label: 'Standart' },
  { id: 'uydu', label: 'Uydu' },
];

/**
 * Altlığı ve "Harita" menüsünü kurar.
 * @param {L.Map} map
 * @param {HTMLElement} host  menü düğmesinin yerleşeceği eleman
 * @param {(theme: 'light'|'dark') => void} onTheme  tema değişince çağrılır
 */
export function setupBasemap(map, host, onTheme = () => {}) {
  let themePref = THEMES.some((t) => t.id === prefs.get('tema')) ? prefs.get('tema') : 'auto';
  let mode = prefs.get('altlik') === 'uydu' ? 'uydu' : 'standart';
  let current = null;
  let token = 0;

  const effectiveTheme = () => (themePref === 'auto' ? (systemDark.matches ? 'dark' : 'light') : themePref);

  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  map.attributionControl.addAttribution(ATTR_DATA);

  async function apply({ notify = true } = {}) {
    const theme = effectiveTheme();
    document.documentElement.dataset.theme = theme;
    if (notify) onTheme(theme); // ilk kurulumda değil, yalnızca kullanıcı/sistem değiştirince
    const t = ++token;
    let layer;
    try {
      layer = await createLayer(mode, theme);
    } catch (e) {
      console.warn('Altlık yüklenemedi, OSM kullanılıyor:', e);
      layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: ATTR_OSM });
    }
    if (t !== token) return; // bu arada başka seçim yapıldı
    if (current) map.removeLayer(current);
    current = layer.addTo(map);
    map.getContainer().dataset.altlik = mode;
    render();
  }

  systemDark.addEventListener('change', () => themePref === 'auto' && apply());

  host.innerHTML = `
    <button class="tool" type="button" data-act="menu" aria-haspopup="true" aria-expanded="false" title="Harita">${icon(['Map'], 18)}</button>
    <div class="map-menu glass" role="dialog" aria-label="Harita ayarları"></div>`;
  const btn = host.querySelector('[data-act="menu"]');
  const menu = host.querySelector('.map-menu');

  function render() {
    menu.innerHTML = `
      <div class="menu-title">Harita</div>
      <div class="mode-grid">
        ${MODES.map(
          (m) => `<button type="button" class="mode ${m.id === mode ? 'on' : ''}" data-mode="${m.id}" aria-pressed="${m.id === mode}">
              <span class="mode-thumb ${m.id}"></span><span>${m.label}</span>
            </button>`,
        ).join('')}
      </div>
      <div class="menu-title">Görünüm</div>
      <div class="segmented" role="group" aria-label="Tema">
        ${THEMES.map((t) => `<button type="button" data-theme="${t.id}" class="${t.id === themePref ? 'on' : ''}" aria-pressed="${t.id === themePref}">${t.label}</button>`).join('')}
      </div>`;
  }

  const setOpen = (open) => {
    host.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
  };
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="menu"]')) return setOpen(!host.classList.contains('open'));
    const m = e.target.closest('[data-mode]');
    if (m && m.dataset.mode !== mode) {
      mode = m.dataset.mode;
      prefs.set('altlik', mode);
      apply();
    }
    const t = e.target.closest('[data-theme]');
    if (t && t.dataset.theme !== themePref) {
      themePref = t.dataset.theme;
      prefs.set('tema', themePref);
      apply();
    }
  });
  document.addEventListener('click', (e) => !host.contains(e.target) && setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  L.DomEvent.disableClickPropagation(host);

  render();
  apply({ notify: false });
}
