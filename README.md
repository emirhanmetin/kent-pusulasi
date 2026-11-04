# Kent Pusulası İzmir (prototip)

İzmir Büyükşehir Belediyesi [Açık Veri Portalı](https://acikveri.bizizmir.com/) servisleriyle, kullanıcının konumuna en yakın kent hizmetlerini harita üzerinde gösteren web uygulaması.

- **Backend (Python / FastAPI):** Veri çekme, temizleme, önbellek, filtreleme, mesafe hesabı ve konum servisi.
- **Arayüz (tarayıcı):** Harita ve liste. Tarayıcılar yalnızca JavaScript çalıştırdığı için harita çizimi ve cihaz konumunu (GPS/Wi-Fi) okuma JS'te kalmak zorunda. Bunun dışında JS tarafında veri mantığı yok.
- **iPhone uygulaması (`mobile/`, Expo / React Native):** Aynı Python API'sini kullanır. iPhone'da gerçek Apple Haritalar ve SF Symbols ile çalışır. Ayrıntılar aşağıda.

## Kurulum ve çalıştırma

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python serve.py
```

Ardından `http://localhost:8000` adresini açın. API belgesi `http://localhost:8000/docs` adresinde.

## Yayına alma

Sunucu Docker ile kurulur: API, kendi rota sunucularımız (OSRM araç + yürüme) ve otomatik https (Caddy).

```bash
cp .env.example .env        # DOMAIN, KP_ENV=prod ve EPIAS_* değerlerini doldurun
sh scripts/osrm_hazirla.sh  # İzmir yol ağını hazırlar (ilk sefer ~10-20 dk)
docker compose up -d --build
```

Yayın modunda (`KP_ENV=prod`):
- API belgesi kapanır ve istek sınırı uygulanır.
- Günlüklere konum ya da IP yazılmaz.
- Ücretsiz genel rota sunucuları kullanılmaz.
- IP konumu kapalıdır.

App Store adımları, metinleri ve gizlilik formu cevapları için bkz. [docs/APP_STORE.md](docs/APP_STORE.md). Uygulama simgesini yeniden üretmek için: `.venv\Scripts\python scripts\ikon_uret.py`.

## iPhone uygulaması (Expo Go ile, Mac gerekmez)

1. iPhone'a App Store'dan **Expo Go** uygulamasını kurun. iPhone ile bilgisayar **aynı Wi-Fi ağında** olmalı.
2. Windows'ta Wi-Fi ağını **Özel** yapın (Ayarlar › Ağ ve İnternet › Wi-Fi › ağın adı › Ağ profili türü: Özel). "Genel" ağda güvenlik duvarı telefondan gelen bağlantıları engeller.
3. Python sunucusunu yerel ağa açık başlatın. Güvenlik duvarı sorarsa yalnızca **Özel ağlar** için izin verin:
   ```bash
   .venv\Scripts\python serve.py --lan
   ```
4. İkinci bir terminalde Expo'yu başlatın. Node.js için de güvenlik duvarı izni istenebilir:
   ```bash
   cd mobile
   npx expo start
   ```
5. Terminalde çıkan QR kodu iPhone'un **Kamera** uygulamasıyla okutun. Uygulama Expo Go'da açılır.

Uygulama, API adresini Expo'nun çalıştığı bilgisayarın IP'sinden kendisi bulur (`http://<ip>:8000`). Farklı bir sunucu kullanmak için `mobile/.env` dosyasına `EXPO_PUBLIC_API_URL=https://...` yazın.

**Aynı ağda olamıyorsanız** (okul/iş ağları cihazları birbirinden yalıtabilir):
- Expo için `npx expo start --tunnel` kullanın.
- Python API'sini de internete açın, örneğin `cloudflared tunnel --url http://localhost:8000`.
- Verilen https adresini `EXPO_PUBLIC_API_URL` olarak yazın.

**App Store / TestFlight:** Expo'nun bulut derlemesiyle (`npx eas-cli@latest build -p ios`) Mac olmadan yapılabilir. Bunun için Apple Developer hesabı (yıllık 99 $) ve https ile yayında çalışan bir Python sunucusu gerekir. Yayın sürümünde iOS, şifrelenmemiş http bağlantılarını engeller.

## Android uygulaması (`mobile-android/`)

iOS sürümünden ayrı bir Expo projesi: harita MapLibre + OpenFreeMap (Google anahtarı gerekmez), Material simgeler,
yalnızca ön planda konum izni. Derleme, imzalama ve Google Play adımları: [mobile-android/GOOGLE_PLAY.md](mobile-android/GOOGLE_PLAY.md).

```powershell
cd mobile-android
.\scripts\build-android.ps1 -ApiUrl https://api.alanadiniz.com.tr -Target aab   # Play paketi
.\scripts\build-android.ps1 -ApiUrl http://192.168.1.6:8000 -Target apk        # yerel ağ test APK'sı
```

### Uygulamanın yapısı

```
mobile/src/app/_layout.tsx          Kök düzen (Expo Router)
mobile/src/app/index.tsx            Ana ekran: Apple Haritalar + sürüklenebilir alt sayfa
mobile/src/components/              İşaret (PinMarker), kategori şeridi, liste satırları, yer kartı
mobile/src/hooks/useUserLocation.ts GPS → IP konumu → Konak; haritaya uzun basınca elle konum
mobile/src/lib/api.ts               Python API istemcisi ve tipler
mobile/src/lib/theme.ts             iOS sistem renkleri (açık/koyu, telefonun ayarını izler)
mobile/src/lib/categories.ts        Kategori simgeleri (SF Symbols / Material Symbols)
```

Denetim: `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor`.

## Konum servisi

Konum şu sırayla belirlenir:

1. **Cihaz konumu (tarayıcı, `web/js/konum.js`):** GPS veya Wi-Fi. Birkaç saniye dinlenir ve en doğru ölçüm seçilir.
   - Yalnızca `localhost` ya da HTTPS üzerinde çalışır. `index.html` dosyasına çift tıklayarak açarsanız çalışmaz.
   - Windows'ta *Ayarlar › Gizlilik ve güvenlik › Konum* açık olmalıdır.
   - İzin verilmezse veya konum alınamazsa neden alınamadığı ekranda açıklanır.
2. **IP'ye göre yaklaşık konum (Python, `GET /api/konum/ip`):** Cihaz konumu alınamazsa devreye girer. Şehir düzeyinde (~15 km) bir sonuç verir ve yalnızca İzmir sınırları içindeyse kullanılır. Bazı operatörler IP'yi İstanbul ya da Ankara'da gösterebilir. Bu adımda IP adresi `ipwho.is` servisine (o çalışmazsa `ipapi.co`) gönderilir.
3. **Varsayılan konum (Konak Meydanı):** "Haritadan seç" ile konumu elle belirleyebilirsiniz. Seçilen konum tarayıcıda hatırlanır.

Koordinattan mahalle ve ilçe tahmini `GET /api/konum/bolge?lat=..&lng=..` ile yapılır. Tahmin, en yakın toplanma alanının mahalle bilgisine dayanır (~2.400 nokta). Mahalle sınır poligonları eklendiğinde bu yöntem nokta-içinde-poligon testine dönüştürülmeli.

## Mesafe hesabı (araçla)

"En yakın" sıralaması kuş uçuşuyla değil, **araçla yol mesafesiyle** yapılıyor (`backend/routing.py`):

1. Kuş uçuşu mesafeyle en yakın 25 aday seçilir. Yol mesafesi kuş uçuşundan kısa olamayacağı için bu güvenli bir ön eleme.
2. Bu adayların araç mesafesi ve süresi OSRM'in `table` servisinden **tek istekte** alınır, adaylar buna göre yeniden sıralanır.
3. Listede 25'ten sonraki kayıtlar kuş uçuşu sırasıyla devam eder ve `≈` işaretiyle gösterilir.
4. Bir kayıt seçildiğinde gerçek araç rotası (`/api/rota`) haritada çizilir.

Sonuçlar 1 saat önbellekte tutulur (~10 m hassasiyetle). Süreler trafiksizdir, İzmir trafiğinde gerçek süre daha uzun olur. Rota servisine ulaşılamazsa kuş uçuşuna geri dönülür ve listede bu belirtilir. Hava kalitesi istasyonlarında (`routing=False`) yol mesafesi hesaplanmaz.

**Rota sunucusu:** Kendi OSRM sunucularımız (araç + yürüme) Docker'da çalışır; veri İzmir ve çevresiyle sınırlıdır.

```bash
sh scripts/osrm_hazirla.sh                         # Türkiye verisini indirir, İzmir'i keser, iki profili işler (~5 dk)
docker compose -f docker-compose.dev.yml up -d     # geliştirme: 127.0.0.1:5001 (araç), :5002 (yürüme)
```

`.env` içinde `OSRM_URL=http://127.0.0.1:5001` ve `OSRM_FOOT_URL=http://127.0.0.1:5002` olmalı. Sunucular Docker Desktop açıldığında kendiliğinden başlar (`restart: unless-stopped`). Yolların güncel kalması için ayda bir `scripts/osrm_hazirla.sh` çalıştırıp `docker compose -f docker-compose.dev.yml restart` yapın. Yayında `docker-compose.yml` aynı veriyi kullanır.

Kendi sunucu tanımlı değilse geliştirmede FOSSGIS'in genel sunucusuna düşülür (adil kullanım, sık 429 hatası); yayında (`KP_ENV=prod`) genel sunucular kullanılmaz.

## Su ve elektrik kesintileri (`backend/outages.py`)

**Su (İZSU):**
- Önce açık veri API'si (`/api/izsu/arizakaynaklisukesintileri`) denenir.
- API hata verirse (Eylül 2026 itibarıyla HTTP 500) İZSU'nun [Arıza ve Bakım Bilgisi](https://www.izsu.gov.tr/bilgi-merkezi/ariza-ve-bakim-bilgisi-sorgulama) sayfası okunur. Sayfa hem arıza hem planlı bakım kayıtlarını içerir, süresi geçmiş planlı bakımlar elenir.
- İZSU'nun `robots.txt` dosyası `/api/` yollarını yasakladığı için onlara istek atılmaz.

**Elektrik (Gediz):**
- Ana kaynak, Gediz Elektrik'in kendi sitesindeki [kesinti haritasını](https://www.gdzelektrik.com.tr/bilgi-merkezi/planli-bakim-ve-iyilestirme-calismalari) besleyen servistir (`/api/outages-v2-unplanned` arızalar, `/api/test-outages` ilçe ilçe planlı kesintiler). Giriş gerektirmez; `robots.txt` bu yolları yasaklamaz.
- Her kayıtta ilçe, mahalleler, **etkilenen sokaklar**, saat aralığı, neden, durum ve **etkilenen alanın çokgeni** bulunur. Haritada bu alan çizilir (çok küçükse daire); sokak adıyla da aranabilir.
- Belgelenmiş bir açık API değildir, haber verilmeden değişebilir. Site art arda isteklere bot koruması uyguladığından 30 ilçe 1,5 sn arayla sorulur (veri 15 dakikada bir arka planda yenilenir; bir tur yaklaşık 1 dakika).
- **Yedek: [EPİAŞ Şeffaflık Platformu](https://seffaflik.epias.com.tr).** Gediz'e ulaşılamazsa ya da bazı ilçeler alınamazsa o kısım EPİAŞ'tan tamamlanır (sokak ve alan bilgisi olmadan). EPİAŞ giriş gerektirir:
  1. [giris.epias.com.tr](https://giris.epias.com.tr) üzerinden ücretsiz bir hesap açın.
  2. Proje kökündeki `.env.example` dosyasını `.env` adıyla kopyalayın.
  3. `EPIAS_USERNAME` ve `EPIAS_PASSWORD` değerlerini yazın.
  4. Sunucuyu yeniden başlatın.
- `.env` git'e eklenmez. EPİAŞ hesabı tanımlı değilse yedek kullanılmaz; menü yine Gediz verisiyle çalışır.

**Haritada gösterim (`backend/areas.py`):** Kesinti kayıtlarında koordinat yok, yalnızca ilçe ve mahalle adları var.
- Belediyenin konumlu verilerinden (toplanma alanı, pazar, taksi durağı, WizmirNET; yaklaşık 1.200 mahalle) her mahallenin yaklaşık merkezi hesaplanır.
- Etkilenen mahalleler haritada 450 m yarıçaplı dairelerle gösterilir: arıza turuncu, planlı mor.
- Adı eşleşmeyen mahalle için konum uydurulmaz. Eylül 2026 testinde mahallelerin %94'ü eşleşti.

## Deprem, hazırlık ve kişisel özellikler

| Özellik | Nerede | Not |
|---|---|---|
| Son depremler | `backend/quakes.py`, menü "Deprem" | AFAD, İzmir ve çevresi, son 7 gün, M1,5+ |
| Mahalle hazırlık endeksi | `backend/preparedness.py`, menü "Hazırlık" | 1 km içindeki toplanma alanı / nüfus ve bina sayısı; A–E notu, bilgilendirme amaçlı |
| Yürüme modu | Toplanma, pazar, taksi, Wi-Fi | Araç/yürüme düğmesi; OSRM yürüme profili |
| Çevrimdışı toplanma | `GET /api/cevrimdisi`, `mobile/src/hooks/useOffline.ts` | Günde bir telefona kaydedilir; sunucu yoksa en yakın alan ve kayıtlı yürüme rotası gösterilir |
| Aile buluşma noktası | Toplanma kartı → "Aile buluşma noktası yap" | Yalnızca telefonda; paylaşılabilir |
| Favoriler, Mahallem | Kart → "Favori"; Yakınımda başlığı | Yalnızca telefonda |
| Hatırlatıcılar | Pazar kartı; Bildirimler ekranı | Telefonun yerel bildirimleri; Expo Go'da da çalışır |
| Anlık bildirimler | `backend/notifications.py`, zil düğmesi | Su/elektrik kesintisi (mahallem ya da 1/3/5 km çevresi), hava kalitesi (PM10 > 100), M4+ deprem. 5 dakikada bir kontrol; Expo Push. **Expo Go'da çalışmaz**, TestFlight/App Store sürümü ve `npx eas-cli init` gerekir |
| Yakınımdaki kesintiler (uygulama açıkken) | `mobile/src/lib/nearbyAlerts.ts` | Telefon 5 dakikada bir ve uygulama öne her geldiğinde kontrol eder, yerel bildirim gösterir. Expo Go'da da çalışır |

Bildirim abonelikleri `.cache/bildirim.db` (SQLite) dosyasında tutulur: yalnızca bildirim anahtarı, ilçe/mahalle ve türler. Konum saklanmaz.

## Değişiklikler ne zaman görünür?

| Değişen | Nasıl yansır |
|---|---|
| `mobile/src/**` (ekranlar, renkler) | `npx expo start` açıkken kaydettiğiniz anda telefonda güncellenir (Fast Refresh) |
| `web/**` | Tarayıcıda sayfayı yenileyin |
| `backend/**` (veri, yeni menü) | Sunucuyu yeniden başlatın ya da `serve.py --reload` ile çalıştırın. Uygulamada Yakınımda'yı açmak veri çeker |
| `mobile/app.json`, yeni paket | Expo'yu durdurup `npx expo start` ile yeniden başlatın. Expo Go'da olmayan yerel modüller için geliştirme derlemesi gerekir |

## API

| Uç | Açıklama |
|---|---|
| `GET /api/katmanlar` | Menü listesi |
| `GET /api/katman/{id}?lat&lng&filtre&q&yenile` | Menünün kayıtları, yakından uzağa sıralı |
| `GET /api/yakinimda` / `GET /api/yakinimda/{kart}?lat&lng` | "Yakınımda" kartları |
| `GET /api/rota?lat&lng&hlat&hlng` | Konumdan hedefe araç rotası (çizgi koordinatları, mesafe, süre) |
| `GET /api/konum/ip` | IP'ye göre yaklaşık konum |
| `GET /api/konum/bolge?lat&lng` | Tahmini mahalle / ilçe |
| `GET /api/cevrimdisi` | Telefona kaydedilecek sıkıştırılmış toplanma alanı listesi |
| `POST /api/bildirim/abone` | Bildirim aboneliği (`token`, `ilce`, `mahalle`, `turler`) |
| `DELETE /api/bildirim/abone?token=` | Aboneliği siler |
| `GET /api/saglik` | Her veri servisinin kayıt sayısı, verinin yaşı, son hata ve abone sayısı |

## Menüler ve veri kaynakları

| Menü | İzBB servisi | Durum (26.09.2026) |
|---|---|---|
| Nöbetçi Eczaneler | `/api/ibb/nobetcieczaneler` | Çalışıyor, her gün 08:00'de yenileniyor |
| Sağlık Noktaları | 12 CBS servisi (`hastaneler`, `acilyardimistasyonu`, `ailesagligimerkezleri`, `kanmerkezleri`, `veterinerlikler`...) | Çalışıyor, 824 sağlık kurumu + 617 veteriner. Kod: `backend/city.py` |
| Toplanma Alanları | `/api/ibb/cbs/afetaciltoplanmaalani` | Çalışıyor, 2.380 alan |
| Otoparklar | İzelman envanteri (portal CSV) + canlı doluluk `/api/ibb/izum/otoparklar` + ücret tarifesi (portal CSV) + OpenStreetMap | 100 belediye otoparkı (8 tanesi canlı doluluklu, 48 tanesi ücretli), ~1.300 OSM otoparkı. Ayrıntılar: `backend/parking.py` |
| Taksi Durakları | `/api/ibb/cbs/taksiduraklari` | Çalışıyor, 406 durak |
| Semt Pazarları | `/api/ibb/cbs/pazaryerleri` | Çalışıyor, 269 pazar |
| Hal Fiyatları | `/api/ibb/halfiyatlari/sebzemeyve/{tarih}`, `/balik/{tarih}` | Çalışıyor, ~165 ürün; hafta sonu bülten yok, son bülten gösterilir |
| Deniz ve Plajlar | `/api/ibb/cbs/plajlar`, `/mavibayrakplajlar` + Körfez Değerleri İzleme (portal CSV) | Çalışıyor, 89 plaj (65 Mavi Bayraklı), 11 körfez istasyonu (ölçüm yaklaşık ayda bir) |
| Ücretsiz Wi-Fi | `/api/ibb/cbs/wizmirnetnoktalari` | Çalışıyor, 463 nokta |
| Su Kesintileri | İZSU API, çalışmazsa izsu.gov.tr arıza ve bakım sayfası | Çalışıyor (API 500 verdiği için sayfadan) |
| Elektrik Kesintileri | Gediz Elektrik kesinti servisi (sokak ve alanlarıyla); yedek EPİAŞ | Hesap gerekmez (EPİAŞ yedeği için ücretsiz hesap) |
| Hava Kalitesi | `/api/ibb/cevre/havadegerleri/{tarih}` | Çalışıyor, veri 1-2 gün geriden geliyor |

## Yapı

```
serve.py              Sunucuyu başlatır (uvicorn)
backend/
  main.py             FastAPI uçları + arayüz dosyalarının sunumu
  sources.py          İzBB servislerinden veri çekme ve ortak şemaya dönüştürme
  outages.py          Su (İZSU) ve elektrik (Gediz, yedek EPİAŞ) kesintileri
  parking.py          Otoparklar: İzelman envanteri + canlı doluluk + ücretler + OpenStreetMap birleşimi
  layers.py           Menü tanımları: filtreler, rozetler, ayrıntılar
  overview.py         "Yakınımda" kartlarının kuralları
  store.py            Önbellek (bellek + .cache/), arka planda yenileme, servis çökünce son veri
  geo.py              Konum servisi: kuş uçuşu mesafe, bölge tahmini, IP konumu
  routing.py          Araçla yol mesafesi ve rota (OSRM)
  text.py             Türkçe büyük/küçük harf, pazar günü ayrıştırma, tarih biçimleri
web/
  index.html, css/style.css
  js/app.js           Harita, liste, menü (yalnızca gösterim)
  js/konum.js         Tarayıcı konumu (GPS) + Python konum servisine istekler
  js/util.js          API çağrısı, ikon, HTML kaçışı
```

### Yeni menü eklemek

`backend/layers.py` dosyasındaki `LAYERS` listesine bir `Layer` ekleyin. Arayüzde değişiklik gerekmez. CBS "önemli yer" servisleri (müze, plaj, muhtarlık vb.) genellikle tek satırla eklenir:

```python
load=lambda c: sources.cbs(c, "servisadi")
```

## Bilinen notlar

- Nöbetçi eczane servisinde `LokasyonX` enlem, `LokasyonY` ise boylam. Adlandırma ters.
- Python'un `str.lower()` fonksiyonu Türkçede yanlış çalışır (`I` harfini `i` yapar). Bu yüzden `text.tr_lower` / `tr_upper` kullanılıyor.
- Görünüm Apple Haritalar'dan esinleniyor. Tema ve harita ayarları sağ üstteki **Harita** düğmesinde:
  - **Harita:** Standart ya da Uydu.
  - **Görünüm:** Otomatik (sistem temasını izler), Açık ya da Koyu. Seçimler tarayıcıda hatırlanıyor.
  - Standart harita [OpenFreeMap](https://openfreemap.org) "liberty" vektör stilinden türetiliyor ve MapLibre GL ile çiziliyor. `web/js/harita.js` stil yüklenmeden önce üç şey yapıyor:
    - Katmanları `PALETTES.light` / `PALETTES.dark` renkleriyle yeniden boyuyor.
    - Dükkan simgeleri, tek yön okları ve ilçe sınırları gibi kalabalık katmanları atıyor.
    - Küçük yazıları yalnızca yakın zoomda gösteriyor. Mahalle adları 15, sokak adları 15–17. zoomdan itibaren görünüyor (`LABEL_MIN_ZOOM`).
  - Arayüz renkleri `web/css/style.css` başındaki `--...` değişkenlerinde (iOS sistem renkleri). Menü renkleri `backend/layers.py` içinde.
  - Uydu görüntüsü Esri World Imagery. Prototip için uygun, ama ticari yayında Esri kullanım koşullarının kontrol edilmesi gerekir.
  - WebGL yoksa ya da stil yüklenemezse otomatik olarak OSM raster altlığına geçiliyor.
- Su kesintisi servisinin alan adları, servis 500 döndürdüğü için doğrulanamadı (`sources.su_kesintileri`).
- Veriler İzBB Açık Veri Lisansı / CC BY 4.0 ile sunuluyor. Kaynak gösterimi harita altında ve menüde yer alıyor.
