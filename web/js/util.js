// Arayüz yardımcıları. Veri işleme Python tarafında (backend/); burada yalnızca gösterim var.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Python API'sini çağırır; hata durumunda sunucunun Türkçe mesajıyla Error fırlatır. */
export async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('sunucuya ulaşılamadı');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail?.hata ?? `HTTP ${res.status}`);
  return body;
}

// Tarayıcıda tutulan küçük tercihler (seçilen konum gibi). Depolama kapalıysa sessizce geçer.
export const prefs = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`kp:${key}`));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`kp:${key}`);
      else localStorage.setItem(`kp:${key}`, JSON.stringify(value));
    } catch {
      /* yok say */
    }
  },
};

// Lucide ikonlarını SVG metnine çevirir. Birden çok ad verilirse ilk bulunanı kullanır.
const iconCache = new Map();
export function icon(names, size = 18) {
  const list = Array.isArray(names) ? names : [names];
  const key = `${list.join('|')}@${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const lib = window.lucide;
  let svg = '';
  for (const n of list) {
    const node = lib?.icons?.[n] ?? lib?.[n];
    if (node && lib.createElement) {
      const el = lib.createElement(node);
      el.setAttribute('width', size);
      el.setAttribute('height', size);
      el.setAttribute('aria-hidden', 'true');
      svg = el.outerHTML;
      break;
    }
  }
  iconCache.set(key, svg);
  return svg;
}
