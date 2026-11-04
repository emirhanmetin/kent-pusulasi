// Konum servisi (tarayıcı tarafı).
//
// Cihazın GPS / Wi-Fi konumunu yalnızca tarayıcı okuyabilir (navigator.geolocation), bu yüzden bu kısım
// JavaScript'te kalmak zorunda. Geri kalanı Python servisinde:
//   /api/konum/ip     -> GPS alınamazsa IP'ye göre yaklaşık konum
//   /api/konum/bolge  -> koordinattan tahmini mahalle / ilçe

import { api } from './util.js';

export class KonumHatasi extends Error {
  constructor(message, code = 0) {
    super(message);
    this.code = code;
  }
}

const MESAJLAR = {
  1: 'Konum izni verilmedi. Adres çubuğundaki kilit simgesinden bu siteye konum izni verebilirsiniz.',
  2: 'Cihaz konumu belirleyemedi. Windows’ta Ayarlar › Gizlilik ve güvenlik › Konum açık olmalı.',
  3: 'Konum zamanında alınamadı.',
};

/**
 * Cihaz konumunu alır. İlk sonuç kaba olabildiği için birkaç saniye dinleyip en doğru ölçümü seçer.
 * @returns {Promise<{lat:number, lng:number, accuracy:number, source:'gps'}>}
 */
export function tarayiciKonumu({ hedefDogruluk = 50, bekleme = 5000, zamanAsimi = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      return reject(new KonumHatasi('Konum yalnızca https ya da localhost üzerinden alınabilir. Siteyi “python serve.py” ile açın.'));
    }
    if (!navigator.geolocation) return reject(new KonumHatasi('Tarayıcınız konum özelliğini desteklemiyor.'));

    let best = null;
    let watchId = null;
    let settleTimer = null;
    let hardTimer = null;
    const bitir = (fn, value) => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(settleTimer);
      clearTimeout(hardTimer);
      fn(value);
    };

    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'gps' };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (best.accuracy <= hedefDogruluk) return bitir(resolve, best);
        settleTimer ??= setTimeout(() => bitir(resolve, best), bekleme);
      },
      (err) => (best ? bitir(resolve, best) : bitir(reject, new KonumHatasi(MESAJLAR[err.code] ?? err.message, err.code))),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: zamanAsimi },
    );
    hardTimer = setTimeout(
      () => (best ? bitir(resolve, best) : bitir(reject, new KonumHatasi(MESAJLAR[3], 3))),
      zamanAsimi + 1000,
    );
  });
}

/** Python servisinden IP tabanlı yaklaşık konum. */
export async function ipKonumu() {
  return api('/api/konum/ip');
}

/** Python servisinden koordinatın tahmini mahalle / ilçesi. */
export async function bolgeBul({ lat, lng }) {
  return api('/api/konum/bolge', { lat, lng });
}
