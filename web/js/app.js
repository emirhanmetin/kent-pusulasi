// Arayüz: menü, liste ve harita. Veri, filtreleme, mesafe hesabı ve konum servisi Python'da (backend/).

import { esc, icon, api, prefs } from './util.js';
import { tarayiciKonumu, ipKonumu, bolgeBul } from './konum.js';
import { setupBasemap } from './harita.js';

const DEFAULT_LOC = { lat: 38.4189, lng: 27.1287, source: 'default' }; // Konak Meydanı
const IZMIR_BOUNDS = L.latLngBounds([37.8, 26.1], [39.45, 28.55]);
const PAGE = 40;
const OVERVIEW = { id: 'yakinimda', title: 'Yakınımda', icon: ['Compass'], color: '#007aff' };

const $ = (s) => document.querySelector(s);
const els = {
  nav: $('#nav'),
  head: $('#panelHead'),
  body: $('#panelBody'),
  badge: $('#locBadge'),
  toast: $('#toast'),
  btnLocate: $('#btnLocate'),
  btnPick: $('#btnPick'),
};

const state = {
  meta: {}, // katman id -> menü bilgisi (Python'dan)
  loc: prefs.get('loc') ?? { ...DEFAULT_LOC },
  bolge: null, // { mahalle, ilce }
  locating: false,
  view: null,
  res: null, // açık menünün son API yanıtı
  filter: {},
  query: '',
  limit: PAGE,
  selected: null,
  pendingSelect: null, // Yakınımda kartından gelinince seçilecek kayıt
  picking: false,
  token: 0,
};

/* ---------- Harita ---------- */

const map = L.map('map', { zoomControl: false, minZoom: 8, maxZoom: 19, maxBounds: IZMIR_BOUNDS.pad(0.5) }).setView([state.loc.lat, state.loc.lng], 13);
L.control.zoom({ position: 'bottomright', zoomInTitle: 'Yakınlaştır', zoomOutTitle: 'Uzaklaştır' }).addTo(map);

/* Masaüstünde liste paneli haritanın üzerinde yüzüyor; harita odaklanırken panelin kapladığı alan boş sayılmalı. */
const isNarrow = () => matchMedia('(max-width: 900px)').matches;
function panelInset() {
  if (isNarrow()) return 0;
  const panel = $('.panel').getBoundingClientRect();
  const mapBox = map.getContainer().getBoundingClientRect();
  return Math.max(0, panel.right - mapBox.left);
}
function fitOpts(maxZoom = 17) {
  return { paddingTopLeft: [panelInset() + 48, 72], paddingBottomRight: [72, 56], maxZoom };
}
function popupOpts() {
  return { maxWidth: 300, minWidth: 240, autoPanPaddingTopLeft: [panelInset() + 16, 72], autoPanPaddingBottomRight: [72, 40] };
}
/** Noktayı, panelin kapatmadığı alanın ortasına getirir. */
function centerOn(lat, lng, zoom) {
  map.setView([lat, lng], zoom, { animate: false });
  const dx = panelInset() / 2;
  if (dx) map.panBy([-dx, 0], { animate: false });
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const userLayer = L.layerGroup().addTo(map);
const lineLayer = L.layerGroup().addTo(map);
let dataLayer = null;
let markers = new Map(); // kayıt id -> { marker, meta, it }
// Tema değişince rota çizgisi yeni temanın renkleriyle yeniden boyanır.
setupBasemap(map, $('#mapMenu'), () => paintRoute());

function clearMapData() {
  if (dataLayer) map.removeLayer(dataLayer);
  dataLayer = null;
  markers = new Map();
  lastRoute = null;
  routeToken++;
  lineLayer.clearLayers();
}

function drawUser() {
  userLayer.clearLayers();
  const { lat, lng, accuracy, source } = state.loc;
  if (source === 'gps' && accuracy && accuracy < 3000) {
    const c = cssVar('--accent');
    L.circle([lat, lng], { radius: accuracy, color: c, fillColor: c, weight: 1, opacity: 0.35, fillOpacity: 0.1, interactive: false }).addTo(userLayer);
  }
  const label = { gps: 'Siz buradasınız', manual: 'Seçtiğiniz konum', ip: 'Yaklaşık konumunuz', default: 'Varsayılan konum' }[source];
  L.marker([lat, lng], {
    icon: L.divIcon({ className: '', html: `<div class="user-dot ${source}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
    keyboard: false,
  })
    .bindTooltip(label, { direction: 'top', offset: [0, -12], className: 'user-tip' })
    .addTo(userLayer);
}

// Listedeki kayıtlar küçük nokta; seçili kayıt büyük iğne olarak gösterilir.
function dotIcon(meta, color, large = false) {
  const s = large ? 34 : 26;
  return L.divIcon({
    className: '',
    html: `<div class="mk" style="--c:${color};width:${s}px;height:${s}px">${icon(meta.icon, large ? 16 : 12)}</div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    popupAnchor: [0, -s / 2],
  });
}

// Seçili kayıt: Apple Haritalar'daki gibi büyük yuvarlak balon + aşağı bakan küçük uç.
function pinIcon(meta, color) {
  return L.divIcon({
    className: '',
    html: `<div class="pin" style="--c:${color}">${icon(meta.icon, 19)}</div>`,
    iconSize: [42, 52],
    iconAnchor: [21, 52],
    popupAnchor: [0, -50],
  });
}

// Önce düz kesikli çizgi çizilir; araç rotası Python servisinden gelince onunla değiştirilir.
// Rota her zaman Apple Haritalar'daki gibi mavi çizilir; tema değişince yeniden boyanır.
let routeToken = 0;
let lastRoute = null; // { coords, dashed }

function paintRoute() {
  lineLayer.clearLayers();
  if (!lastRoute) return null;
  const opts = { lineCap: 'round', lineJoin: 'round', interactive: false };
  if (lastRoute.dashed) {
    return L.polyline(lastRoute.coords, { ...opts, color: cssVar('--route'), weight: 3, opacity: 0.7, dashArray: '1 8' }).addTo(lineLayer);
  }
  L.polyline(lastRoute.coords, { ...opts, color: cssVar('--route-casing'), weight: 9, opacity: 0.95 }).addTo(lineLayer);
  return L.polyline(lastRoute.coords, { ...opts, color: cssVar('--route'), weight: 5.5, opacity: 1 }).addTo(lineLayer);
}

function drawLine(meta, it, { fit = false } = {}) {
  const token = ++routeToken;
  lastRoute = { coords: [[state.loc.lat, state.loc.lng], [it.lat, it.lng]], dashed: true };
  paintRoute();
  if (!meta.routing) return;

  api('/api/rota', { lat: state.loc.lat, lng: state.loc.lng, hlat: it.lat, hlng: it.lng, mod: it.mode ?? modeOf(meta) })
    .then((r) => {
      if (token !== routeToken) return; // bu arada başka kayıt seçildi
      lastRoute = { coords: r.koordinatlar, dashed: false };
      const b = paintRoute().getBounds();
      if (fit && !map.getBounds().pad(-0.05).contains(b)) map.fitBounds(b, fitOpts());
    })
    .catch(() => {
      /* rota alınamazsa düz çizgi kalır */
    });
}

function distanceLine(it) {
  if (!it.distText) return '';
  if (it.distKind === 'yol') {
    const walk = it.mode === 'yuruyus';
    return `<div class="pop-dist">${icon(walk ? 'Footprints' : 'Car', 14)} ${esc(it.distText)} yol${it.durationText ? ` · ~${esc(it.durationText)} ${walk ? 'yürüyerek' : 'araçla <span class="muted">(trafiksiz)</span>'}` : ''}</div>`;
  }
  return `<div class="pop-dist">${icon('Ruler', 14)} ${esc(it.distText)} kuş uçuşu</div>`;
}

function popupHtml(meta, it) {
  // Başlangıç noktası verilmiyor: Google Haritalar cihazın kendi konumunu kullanır.
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lng}&travelmode=${it.mode === 'yuruyus' ? 'walking' : 'driving'}`;
  return `<div class="pop">
    <div class="pop-title">${esc(it.name)}</div>
    ${it.badge ? `<span class="badge" style="--c:${it.color}">${esc(it.badge)}</span>` : ''}
    ${distanceLine(it)}
    <dl>${it.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${meta.outage ? '' : `<div class="pop-actions">
      <a class="btn primary" href="${esc(dirUrl)}" target="_blank" rel="noopener" title="Yol tarifi">${icon('Car', 15)} ${it.durationText ? esc(it.durationText) : 'Yol tarifi'}</a>
      ${it.phone ? `<a class="btn" href="tel:${esc(it.phone)}">${icon('Phone', 14)} Ara</a>` : ''}
    </div>`}
  </div>`;
}

/* ---------- Menü & yönlendirme ---------- */

function buildNav(layers) {
  const groups = [{ title: null, items: [OVERVIEW] }];
  for (const l of layers) {
    let g = groups.find((x) => x.title === l.group);
    if (!g) groups.push((g = { title: l.group, items: [] }));
    g.items.push(l);
  }
  els.nav.innerHTML = groups
    .map(
      (g) =>
        (g.title ? `<div class="nav-group">${esc(g.title)}</div>` : '') +
        g.items
          .map(
            (it) => `<a class="nav-item" href="#${it.id}" data-id="${it.id}" style="--c:${it.color}">
                <span class="nav-ico">${icon(it.icon, 17)}</span><span>${esc(it.navTitle ?? it.title)}</span>
              </a>`,
          )
          .join(''),
    )
    .join('');
}

function route() {
  const id = location.hash.slice(1);
  const view = id === OVERVIEW.id || state.meta[id] ? id : OVERVIEW.id;
  if (view !== state.view) {
    state.view = view;
    state.query = '';
    state.limit = PAGE;
    state.selected = null;
  }
  els.nav.querySelectorAll('.nav-item').forEach((a) => {
    const on = a.dataset.id === view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  render();
}

function render() {
  const token = ++state.token;
  clearMapData();
  if (state.view === OVERVIEW.id) renderOverview(token);
  else renderLayer(state.meta[state.view], token);
}

const alive = (token) => token === state.token;
const spinner = '<span class="spinner" aria-hidden="true"></span>';

function headHtml({ title, color, iconName, intro }) {
  return `<div class="head-title" style="--c:${color}">
      <span class="head-ico">${icon(iconName, 20)}</span><h1>${esc(title)}</h1>
    </div>
    <p class="head-intro">${esc(intro)}</p>`;
}

/* ---------- Menü görünümü ---------- */

// Araçla / yürüyerek: menü başına seçim; seçilmemişse menünün varsayılanı (ör. toplanma = yürüyerek)
const modes = {};
const modeOf = (meta) => modes[meta.id] ?? meta.defaultMode ?? 'arac';

function fetchLayer(meta, { yenile = false } = {}) {
  return api(`/api/katman/${meta.id}`, {
    lat: state.loc.lat,
    lng: state.loc.lng,
    mod: meta.routing && !meta.outage ? modeOf(meta) : null,
    filtre: state.filter[meta.id],
    q: state.query.trim(),
    yenile: yenile ? 1 : null,
  });
}

async function renderLayer(meta, token, { yenile = false } = {}) {
  els.head.innerHTML = `${headHtml({ title: meta.title, color: meta.color, iconName: meta.icon, intro: meta.intro })}
    <div class="status" id="status">${spinner} Veri yükleniyor…</div>
    <div class="controls" id="controls"></div>`;
  els.body.innerHTML = skeleton();

  const slowTimer = setTimeout(() => {
    if (alive(token)) $('#status').innerHTML = `${spinner} Belediye servisi yavaş yanıt veriyor, bekleniyor…`;
  }, 4000);
  let res;
  try {
    res = await fetchLayer(meta, { yenile });
  } catch (e) {
    if (!alive(token)) return;
    $('#status').innerHTML = `<span class="dot err"></span> Veri alınamadı (${esc(e.message)})`;
    els.body.innerHTML = `<div class="notice err">
        <strong>Veri alınamadı</strong>
        <p>${esc(meta.errorText)}</p>
        <div class="notice-actions">
          <button class="btn primary" data-act="retry">${icon('RefreshCw', 14)} Tekrar dene</button>
          ${meta.errorLink ? `<a class="btn" href="${esc(meta.errorLink.href)}" target="_blank" rel="noopener">${esc(meta.errorLink.label)}</a>` : ''}
        </div>
      </div>`;
    centerOn(state.loc.lat, state.loc.lng, 13);
    return;
  } finally {
    clearTimeout(slowTimer);
  }
  if (!alive(token)) return;

  state.res = res;
  renderStatus(res.durum);
  renderControls(meta, res);
  showItems(meta, { fit: true });
}

async function refreshItems(meta) {
  const token = state.token;
  try {
    const res = await fetchLayer(meta);
    if (!alive(token)) return;
    state.res = res;
    showItems(meta, { fit: false });
  } catch (e) {
    toast(`Veri alınamadı: ${e.message}`);
  }
}

function renderStatus(d) {
  $('#status').innerHTML = `
    <span class="dot ${d.eski ? 'warn' : 'ok'}"></span>
    <span class="status-text">${
      d.eski
        ? `Belediye servisi yanıt vermedi (${esc(d.hata)}). ${esc(d.guncellendiMetin)} alınan veri gösteriliyor.`
        : `Güncellendi: ${esc(d.guncellendiMetin)}${d.damga ? ` · ${esc(d.damga)}` : ''}`
    }</span>
    <button class="link" data-act="refresh" title="Veriyi belediyeden yeniden çek">${icon('RefreshCw', 13)} Yenile</button>`;
}

const OUTAGE_LEGEND = [
  ['Arıza', '#ff9500'],
  ['Planlı', '#5856d6'],
];

function renderControls(meta, res) {
  const fs = res.filtreler;
  const mode = modeOf(meta);
  $('#controls').innerHTML = `
    ${
      meta.routing && !meta.outage
        ? `<div class="chips mode-chips" role="group" aria-label="Ulaşım şekli">${[
            ['arac', 'Car', 'Araçla'],
            ['yuruyus', 'Footprints', 'Yürüyerek'],
          ]
            .map(([id, ic, label]) => `<button class="chip${id === mode ? ' on' : ''}" data-mode="${id}" aria-pressed="${id === mode}">${icon(ic, 13)} ${label}</button>`)
            .join('')}</div>`
        : ''
    }
    ${meta.outage ? `<div class="legend">${OUTAGE_LEGEND.map(([k, c]) => `<span><i style="--c:${c}"></i>${k}</span>`).join('')}<span class="muted">Daireler etkilenen mahalleleri gösterir</span></div>` : ''}
    ${fs.length ? `<div class="chips" role="group" aria-label="Filtre">${fs.map((f) => `<button class="chip${f.id === res.filtre ? ' on' : ''}" data-filter="${f.id}" aria-pressed="${f.id === res.filtre}">${esc(f.label)}</button>`).join('')}</div>` : ''}
    ${
      meta.search
        ? `<label class="search">${icon('Search', 16)}<input type="search" id="q" placeholder="${esc(meta.searchPlaceholder)}" value="${esc(state.query)}" autocomplete="off"></label>`
        : ''
    }`;
}

function showItems(meta, { fit }) {
  const { items } = state.res;
  renderList(meta);
  drawMarkers(meta, items);
  if (!fit) return;
  if (meta.noMap) return centerOn(state.loc.lat, state.loc.lng, 13);
  if (meta.outage && !state.pendingSelect) return fitAllAreas(items);
  // Yalnızca "Yakınımda" kartından gelindiyse o kayıt seçilir; aksi halde hiçbir şey seçili gelmez,
  // harita konumunuzu ve en yakın birkaç kaydı gösterecek şekilde odaklanır.
  const wanted = state.pendingSelect?.layer === meta.id ? items.find((it) => it.id === state.pendingSelect.id) : null;
  state.pendingSelect = null;
  if (wanted) return selectItem(meta, wanted, { fit: true });
  const nearest = items.filter((it) => it.dist != null).slice(0, 3);
  if (!nearest.length) return centerOn(state.loc.lat, state.loc.lng, 13);
  const pts = [[state.loc.lat, state.loc.lng], ...nearest.map((it) => [it.lat, it.lng])];
  map.fitBounds(L.latLngBounds(pts), { ...fitOpts(16), animate: false });
}

function renderList(meta) {
  const { items, toplam } = state.res;
  if (!items.length) {
    const filtered = state.query.trim() || state.res.filtreler.find((f) => f.id === state.res.filtre && f.id !== 'all');
    els.body.innerHTML = `<div class="empty">${icon(meta.icon, 28)}<p>${esc(filtered ? 'Bu filtreyle eşleşen kayıt yok.' : meta.emptyText)}</p></div>`;
    return;
  }
  const shown = items.slice(0, state.limit);
  els.body.innerHTML = `
    <div class="list-meta">${items.length} kayıt${items.length !== toplam ? ` <span class="muted">/ toplam ${toplam}</span>` : ''}${listNote(meta, items)}</div>
    <ul class="list">${shown.map((it) => (it.price ? priceRow(it) : meta.outage || meta.noMap ? outageRow(it) : rowHtml(meta, it))).join('')}</ul>
    ${items.length > shown.length ? `<button class="more" data-act="more">${Math.min(PAGE, items.length - shown.length)} kayıt daha göster</button>` : ''}`;
}

function listNote(meta, items) {
  if (items[0].dist == null) return '';
  const m = state.res.mesafe;
  if (!meta.routing) return ' · size en yakından (kuş uçuşu)';
  if (m.tur !== 'yol') return m.hata ? ' · kuş uçuşu (rota servisi şu an yanıt vermiyor)' : ' · size en yakından (kuş uçuşu)';
  const rest = items.length > m.yolSayisi ? `; sonrakiler kuş uçuşu (≈)` : '';
  return ` · ${m.mod === 'yuruyus' ? 'yürüyerek' : 'araçla'} en yakından${rest}`;
}

function rowHtml(meta, it) {
  return `<li><button class="row${state.selected === it.id ? ' sel' : ''}" data-id="${esc(it.id)}">
      <span class="row-dot" style="--c:${it.color}">${icon(meta.icon, 14)}</span>
      <span class="row-main">
        <span class="row-title">${esc(it.name)}</span>
        <span class="row-sub">${esc(it.sub)}</span>
      </span>
      <span class="row-side">
        ${
          it.distKind === 'yol'
            ? `<span class="dist">${esc(it.distText)}</span>${it.durationText ? `<span class="dist-sub">${icon(it.mode === 'yuruyus' ? 'Footprints' : 'Car', 11)} ${esc(it.durationText)}</span>` : ''}`
            : it.distText
              ? `<span class="dist air" title="Kuş uçuşu">≈ ${esc(it.distText)}</span>`
              : ''
        }
        ${it.badge ? `<span class="badge" style="--c:${it.color}">${esc(it.badge)}</span>` : ''}
      </span>
    </button></li>`;
}

// Hal fiyatı: ürün ve tür; sağda ortalama, altında en düşük – en yüksek
function priceRow(it) {
  const p = it.price;
  const unit = p.unit ? ` / ${esc(p.unit.toLocaleLowerCase('tr-TR'))}` : '';
  return `<li class="price-row">
      <span class="row-main"><span class="row-title">${esc(it.name)}</span><span class="row-sub">${esc(it.kind || '')}</span></span>
      <span class="row-side"><span class="dist">${esc(p.avg ?? '—')}<span class="muted">${unit}</span></span>
        ${p.min && p.max && p.min !== p.max ? `<span class="dist-sub">${esc(p.min)} – ${esc(p.max)}</span>` : ''}</span>
    </li>`;
}

function outageRow(it) {
  const kindColor = it.color || (it.kind === 'Planlı' ? '#5856d6' : '#ff9500');
  const onMap = it.lat != null;
  return `<li class="outage${onMap ? ' row' : ''}${state.selected === it.id ? ' sel' : ''}" ${onMap ? `data-id="${esc(it.id)}" role="button" tabindex="0"` : ''}>
      <div class="outage-top"><strong>${esc(it.ilce || 'İlçe belirtilmemiş')}</strong>
        <span class="outage-side">${it.distText ? `<span class="dist air">≈ ${esc(it.distText)}</span>` : ''}${it.kind ? `<span class="badge" style="--c:${kindColor}">${esc(it.kind)}</span>` : ''}</span></div>
      ${it.mahalle ? `<div class="outage-mah">${esc(it.mahalle)}</div>` : ''}
      ${it.reason ? `<div class="outage-reason">${esc(it.reason)}</div>` : ''}
      ${it.description ? `<p>${esc(it.description)}</p>` : ''}
      <div class="outage-meta">
        ${onMap ? '' : `<span>${icon('MapPinOff', 13)} Haritada gösterilemiyor</span>`}
        ${it.duration ? `<span>${icon('Clock', 13)} ${esc(it.duration)}</span>` : ''}
        ${it.subscribers ? `<span>${icon('Users', 13)} ${Number(it.subscribers).toLocaleString('tr-TR')} abone</span>` : ''}
        ${it.company ? `<span>${esc(it.company)}</span>` : ''}
      </div>
    </li>`;
}

function skeleton() {
  return `<ul class="list">${Array.from({ length: 7 }, () => '<li class="skel"><span></span><span></span></li>').join('')}</ul>`;
}

function drawMarkers(meta, items) {
  clearMapData();
  if (meta.noMap) return;
  dataLayer = meta.cluster
    ? L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 46,
        disableClusteringAtZoom: 16,
        iconCreateFunction: (c) =>
          L.divIcon({ className: '', html: `<div class="cluster" style="--c:${meta.color}">${c.getChildCount()}</div>`, iconSize: [36, 36] }),
      })
    : L.featureGroup();
  if (meta.outage) drawAreas(meta, items);
  if (meta.areaCircles) {
    for (const it of items) {
      if (it.lat == null) continue;
      L.circle([it.lat, it.lng], { radius: 420, ...areaStyle(it.color, false), interactive: false }).addTo(dataLayer);
    }
  }
  for (const it of items) {
    if (it.lat == null) continue;
    // Kesinti: kaydın kendi işareti (size en yakın etkilenen mahalle) dışındaki mahallelere de küçük işaret
    if (meta.outage) {
      for (const a of it.areas ?? []) {
        if (a.lat === it.lat && a.lng === it.lng) continue;
        const extra = L.marker([a.lat, a.lng], { icon: dotIcon(meta, it.color), title: `${it.name} · ${a.name}` });
        extra.bindPopup(() => popupHtml(meta, it), popupOpts());
        extra.on('click', () => selectItem(meta, it, { fromMap: true }));
        dataLayer.addLayer(extra);
      }
    }
    const sel = it.id === state.selected;
    const m = L.marker([it.lat, it.lng], {
      icon: sel ? pinIcon(meta, it.color) : dotIcon(meta, it.color),
      zIndexOffset: sel ? 800 : 0,
      title: it.name,
      riseOnHover: true,
    });
    m.bindPopup(() => popupHtml(meta, it), popupOpts());
    m.on('click', () => selectItem(meta, it, { fromMap: true }));
    markers.set(it.id, { marker: m, meta, it });
    dataLayer.addLayer(m);
  }
  dataLayer.addTo(map);
}

// Kesintiler: etkilenen her mahalle yarı saydam bir daire; seçilen kesintininkiler koyulaşır.
const AREA_RADIUS = 450; // metre; mahalle merkezinin yaklaşık olduğunu hissettirecek kadar geniş
let areaCircles = new Map(); // kesinti id -> L.Circle[]

function areaStyle(color, selected) {
  return { color, weight: selected ? 2.5 : 1.2, opacity: selected ? 0.95 : 0.6, fillColor: color, fillOpacity: selected ? 0.32 : 0.14 };
}

function drawAreas(meta, items) {
  areaCircles = new Map();
  for (const it of items) {
    const circles = (it.areas ?? []).map((a) =>
      L.circle([a.lat, a.lng], { radius: AREA_RADIUS, ...areaStyle(it.color, it.id === state.selected) })
        .bindTooltip(`${a.name} · ${it.kind ?? ''}`, { direction: 'top', className: 'user-tip' })
        .on('click', () => {
          const m = markers.get(it.id)?.marker;
          selectItem(meta, it, { fromMap: true });
          m?.openPopup();
        }),
    );
    circles.forEach((c) => dataLayer.addLayer(c));
    if (circles.length) areaCircles.set(it.id, circles);
  }
}

function highlightAreas(id) {
  for (const [itemId, circles] of areaCircles) {
    const color = markers.get(itemId)?.it.color;
    circles.forEach((c) => c.setStyle(areaStyle(color, itemId === id)));
  }
}

function fitAllAreas(items) {
  const pts = items.flatMap((it) => (it.areas ?? []).map((a) => [a.lat, a.lng]));
  if (!pts.length) return centerOn(state.loc.lat, state.loc.lng, 11);
  map.fitBounds(L.latLngBounds(pts), { ...fitOpts(14), animate: false });
}

function highlightMarker(id) {
  const prev = markers.get(state.selected);
  if (prev && state.selected !== id) {
    prev.marker.setIcon(dotIcon(prev.meta, prev.it.color));
    prev.marker.setZIndexOffset(0);
  }
  const next = markers.get(id);
  if (next) {
    next.marker.setIcon(pinIcon(next.meta, next.it.color));
    next.marker.setZIndexOffset(800);
  }
}

function selectItem(meta, it, { fit = false, fromMap = false } = {}) {
  highlightMarker(it.id);
  state.selected = it.id;
  els.body.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r.dataset.id === it.id));
  if (fromMap) els.body.querySelector(`.row[data-id="${CSS.escape(it.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (meta.outage) {
    highlightAreas(it.id);
    const m = markers.get(it.id)?.marker;
    if (fromMap || !m) return;
    const pts = (it.areas ?? []).map((ar) => [ar.lat, ar.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.6), { ...fitOpts(15), animate: false });
    if (isNarrow()) $('.map-area').scrollIntoView({ behavior: 'smooth' });
    return m.openPopup();
  }
  drawLine(meta, it, { fit });

  const m = markers.get(it.id)?.marker;
  if (!m) return;
  if (fromMap) return m.openPopup(); // ikon büyüdüğü için balon konumu yeniden hesaplansın
  if (fit) {
    map.fitBounds(L.latLngBounds([state.loc.lat, state.loc.lng], [it.lat, it.lng]), { ...fitOpts(), animate: false });
  } else if (isNarrow()) {
    $('.map-area').scrollIntoView({ behavior: 'smooth' });
  }
  if (dataLayer.zoomToShowLayer) dataLayer.zoomToShowLayer(m, () => m.openPopup());
  else m.openPopup();
}

/* ---------- Yakınımda ---------- */

function areaLine() {
  if (state.locating) return `${spinner} Konumunuz alınıyor…`;
  const b = state.bolge;
  if (!b) return `${spinner} Bölgeniz belirleniyor…`;
  if (!b.izmirde) return `${icon('MapPin', 14)} <span>Konum İzmir dışında. “Haritadan seç” ile İzmir’de bir nokta seçin.</span>`;
  if (!b.mahalle) return `${icon('MapPin', 14)} <span>Bölge belirlenemedi. Konumunuzu haritadan seçebilirsiniz.</span>`;
  return `${icon('MapPin', 14)} <span>Tahmini bölgeniz: <strong>${esc(b.mahalle)}</strong>, ${esc(b.ilce)}</span>`;
}

async function renderOverview(token) {
  els.head.innerHTML = `${headHtml({
    title: OVERVIEW.title,
    color: OVERVIEW.color,
    iconName: OVERVIEW.icon,
    intro: 'Konumunuza en yakın hizmetler tek ekranda. Bir karta tıklayarak ayrıntıya geçebilirsiniz.',
  })}
    <div class="status" id="area">${areaLine()}</div>`;
  els.body.innerHTML = `<div class="cards" id="cards"><div class="skel-line"></div></div>`;
  centerOn(state.loc.lat, state.loc.lng, 14);

  let cards;
  try {
    cards = await api('/api/yakinimda');
  } catch (e) {
    if (alive(token)) els.body.innerHTML = `<div class="notice err"><strong>Sunucuya ulaşılamadı</strong><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!alive(token)) return;

  $('#cards').innerHTML = cards
    .map((c) => {
      const meta = state.meta[c.layer];
      return `<button class="card" data-go="${c.layer}" data-card="${c.id}" style="--c:${meta.color}">
          <span class="card-ico">${icon(meta.icon, 18)}</span>
          <span class="card-body">
            <span class="card-label">${esc(c.label)}</span>
            <span class="card-main"><span class="skel-line"></span></span>
            <span class="card-sub"></span>
          </span>
          <span class="card-arrow">${icon('ChevronRight', 16)}</span>
        </button>`;
    })
    .join('');

  dataLayer = L.featureGroup().addTo(map);
  const group = dataLayer;
  let fitTimer;
  const refit = () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      if (!alive(token)) return;
      const pts = [[state.loc.lat, state.loc.lng], ...group.getLayers().map((m) => m.getLatLng())];
      map.fitBounds(L.latLngBounds(pts), fitOpts(16));
    }, 250);
  };

  for (const c of cards) {
    const el = $(`.card[data-card="${c.id}"]`);
    const set = (main, sub, cls = '') => {
      if (!alive(token)) return;
      const mainEl = el.querySelector('.card-main');
      mainEl.textContent = main;
      mainEl.className = `card-main ${cls}`;
      el.querySelector('.card-sub').textContent = sub ?? '';
    };
    const slow = setTimeout(() => set('Belediye servisi yavaş yanıt veriyor…', '', 'muted'), 5000);
    api(`/api/yakinimda/${c.id}`, { lat: state.loc.lat, lng: state.loc.lng })
      .then((r) => {
        clearTimeout(slow);
        if (!alive(token)) return;
        set(r.main, r.sub, r.cls);
        if (!r.item) return;
        el.dataset.item = r.item.id;
        const meta = state.meta[c.layer];
        L.marker([r.item.lat, r.item.lng], { icon: dotIcon(meta, r.item.color, true), title: r.item.name })
          .bindPopup(() => popupHtml(meta, r.item), popupOpts())
          .addTo(group);
        refit();
      })
      .catch((e) => {
        clearTimeout(slow);
        set('Servis şu anda yanıt vermiyor', e.message, 'err');
      });
  }
}

/* ---------- Konum ---------- */

function renderLocBadge() {
  const { source, accuracy } = state.loc;
  let text;
  if (state.locating) {
    els.badge.innerHTML = `${spinner} Konum alınıyor…`;
    return;
  }
  if (source === 'gps') text = `Konumunuz${accuracy ? ` (±${Math.round(accuracy)} m)` : ''}`;
  else if (source === 'manual') text = 'Haritadan seçilen konum';
  else if (source === 'ip') text = `Yaklaşık konum (internet bağlantısına göre)`;
  else text = 'Varsayılan konum: Konak';
  const b = state.bolge;
  const area = b?.mahalle && source !== 'default' && source !== 'ip' ? ` · ${b.mahalle}, ${b.ilce}` : '';
  const dot = source === 'gps' || source === 'manual' ? 'ok' : 'warn';
  els.badge.innerHTML = `<span class="dot ${dot}"></span>${esc(text + area)}`;
}

async function updateBolge() {
  const loc = state.loc;
  try {
    const b = await bolgeBul(loc);
    if (loc !== state.loc) return; // bu arada konum değişti
    state.bolge = b;
  } catch {
    state.bolge = { izmirde: true, mahalle: null };
  }
  renderLocBadge();
  if (state.view === OVERVIEW.id && $('#area')) $('#area').innerHTML = areaLine();
}

function setLocation(loc, { save = false } = {}) {
  state.loc = loc;
  state.bolge = null;
  prefs.set('loc', save ? loc : null);
  if (!IZMIR_BOUNDS.contains([loc.lat, loc.lng])) toast('Konumunuz İzmir dışında görünüyor. “Haritadan seç” ile İzmir’de bir nokta seçebilirsiniz.');
  drawUser();
  renderLocBadge();
  updateBolge();
  render();
}

/**
 * Konum bulma sırası:
 * 1. Tarayıcı konumu (GPS / Wi-Fi) - en doğrusu
 * 2. Olmazsa Python servisi üzerinden IP'ye göre yaklaşık konum (yalnızca İzmir içindeyse)
 * 3. O da olmazsa varsayılan konum (Konak); kullanıcı haritadan seçebilir
 */
async function locate() {
  state.locating = true;
  renderLocBadge();
  if (state.view === OVERVIEW.id && $('#area')) $('#area').innerHTML = areaLine();

  let gpsHata;
  try {
    const fix = await tarayiciKonumu();
    state.locating = false;
    setLocation(fix);
    if (fix.accuracy > 1000) toast(`Konum düşük doğrulukla alındı (±${Math.round(fix.accuracy / 100) / 10} km). Gerekirse “Haritadan seç” ile düzeltin.`);
    return;
  } catch (e) {
    gpsHata = e.message;
  }

  try {
    const ip = await ipKonumu();
    state.locating = false;
    if (ip.izmirde) {
      setLocation(ip);
      toast(`${gpsHata} Şimdilik internet bağlantınıza göre yaklaşık konum (${ip.sehir}) kullanılıyor.`);
      return;
    }
    toast(`${gpsHata} İnternet bağlantınız ${ip.sehir} görünüyor; varsayılan konum kullanılıyor.`);
  } catch {
    state.locating = false;
    toast(gpsHata);
  }
  renderLocBadge();
  if (!state.bolge) updateBolge();
  if (state.view === OVERVIEW.id && $('#area')) $('#area').innerHTML = areaLine();
}

function setPicking(on) {
  state.picking = on;
  els.btnPick.classList.toggle('on', on);
  $('.map-area').classList.toggle('picking', on);
  if (on) toast('Konumunuzu seçmek için haritada bir noktaya tıklayın.');
}

/* ---------- Olaylar ---------- */

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 6000);
}

els.btnLocate.addEventListener('click', locate);
els.btnPick.addEventListener('click', () => setPicking(!state.picking));
map.on('click', (e) => {
  if (!state.picking) return;
  setPicking(false);
  els.toast.classList.remove('show');
  setLocation({ lat: e.latlng.lat, lng: e.latlng.lng, source: 'manual' }, { save: true });
});

els.head.addEventListener('click', (e) => {
  const meta = state.meta[state.view];
  if (!meta) return;
  const modeChip = e.target.closest('[data-mode]');
  if (modeChip) {
    modes[meta.id] = modeChip.dataset.mode;
    state.limit = PAGE;
    renderControls(meta, state.res);
    fetchLayer(meta)
      .then((res) => {
        state.res = res;
        showItems(meta, { fit: true });
      })
      .catch((err) => toast(`Veri alınamadı: ${err.message}`));
    return;
  }
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    state.filter[meta.id] = chip.dataset.filter;
    state.limit = PAGE;
    els.head.querySelectorAll('.chip').forEach((c) => {
      const on = c === chip;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on);
    });
    fetchLayer(meta)
      .then((res) => {
        state.res = res;
        showItems(meta, { fit: true });
      })
      .catch((err) => toast(`Veri alınamadı: ${err.message}`));
    return;
  }
  if (e.target.closest('[data-act="refresh"]')) renderLayer(meta, ++state.token, { yenile: true });
});

let searchTimer;
els.head.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value;
    state.limit = PAGE;
    refreshItems(state.meta[state.view]);
  }, 200);
});

els.body.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) {
    if (card.dataset.item) state.pendingSelect = { layer: card.dataset.go, id: card.dataset.item };
    location.hash = card.dataset.go;
    return;
  }
  const meta = state.meta[state.view];
  if (!meta || !state.res) return;
  const row = e.target.closest('.row');
  if (row) {
    const it = state.res.items.find((x) => x.id === row.dataset.id);
    if (it) selectItem(meta, it);
    return;
  }
  if (e.target.closest('[data-act="more"]')) {
    state.limit += PAGE;
    renderList(meta);
    return;
  }
  if (e.target.closest('[data-act="retry"]')) render();
});

window.addEventListener('hashchange', route);

/* ---------- Başlat ---------- */

async function start() {
  $('#brandLogo').innerHTML = icon('Compass', 20);
  els.btnLocate.innerHTML = icon(['Navigation'], 18);
  els.btnPick.innerHTML = icon(['MapPinPlus', 'MapPin'], 18);

  let layers;
  try {
    layers = await api('/api/katmanlar');
  } catch (e) {
    els.body.innerHTML = `<div class="notice err"><strong>Sunucu çalışmıyor</strong>
      <p>Arayüz Python sunucusuna ulaşamadı (${esc(e.message)}). Proje klasöründe <code>python serve.py</code> komutunu çalıştırıp <code>http://localhost:8000</code> adresini açın.</p></div>`;
    return;
  }
  state.meta = Object.fromEntries(layers.map((l) => [l.id, l]));
  buildNav(layers);
  drawUser();
  renderLocBadge();

  if (state.loc.source === 'manual') {
    updateBolge();
    route();
    return;
  }
  route();
  locate();
}

start();
