# Kent Pusulası — Android / Google Play

iOS sürümünden (`../mobile/`) ayrı Android projesi. Paket adı `com.kentpusulasi.izmir`, hedef API 36 (Android 16),
en düşük API 24 (Android 7). Harita MapLibre + OpenFreeMap: Google Haritalar anahtarı ya da faturalandırma gerekmez.

## iOS sürümünden farkları

| Konu | iOS (`mobile/`) | Android (`mobile-android/`) |
|---|---|---|
| Harita | Apple Haritalar (`react-native-maps`) | MapLibre + OpenFreeMap vektör altlığı, açık/koyu stil |
| Uydu görünümü | Var | Yok (Esri görüntüsü ticari lisans ister) |
| Simgeler | SF Symbols | Material Symbols |
| Yol tarifi / paylaşım bağlantısı | maps.apple.com | Google Haritalar bağlantısı (telefondaki harita uygulaması açılır) |
| İzinler | Kullanırken konum | Yalnızca ön planda konum + bildirim; arka plan konumu, mikrofon, depolama açıkça engelli |
| Anlık (uzak) bildirim | APNs (EAS) | Henüz kapalı: Firebase (FCM) kurulumu gerekir, aşağıya bakın. Yerel hatırlatıcılar ve "yakınımdaki kesintiler" uyarısı çalışır |

## Derleme (bu bilgisayarda)

```powershell
# Google Play paketi (sunucu https adresiyle)
.\scripts\build-android.ps1 -ApiUrl https://api.alanadiniz.com.tr -Target aab -VersionCode 1

# Telefona elle kurulacak test APK'sı (bilgisayardaki sunucuya yerel ağdan bağlanır)
.\scripts\build-android.ps1 -ApiUrl http://192.168.1.6:8000 -Target apk
```

Çıktılar proje kökündeki `dist-android/` klasörüne yazılır. Her Play yüklemesinde `-VersionCode` bir artmalıdır.
`http://` adresli derleme yalnızca test içindir; betik AAB için buna izin vermez.

Gerekenler: Node.js, JDK 21, Android SDK (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1).

Harita işaretleri haritanın kendi katmanında PNG simgelerle çizilir (`assets/map-icons/`). `src/lib/categories.ts`
içine yeni bir kategori ya da simge eklerseniz derlemeden önce simgeleri yeniden üretin:

```bash
python scripts/harita_simgeleri.py
```

## Yükleme anahtarı (ÇOK ÖNEMLİ)

`credentials/upload-keystore.jks` ve `credentials/keystore.properties` Play'e yüklenen her paketi imzalar.

- Bu iki dosyayı **şimdi** bir parola yöneticisine ya da şifreli bir USB belleğe yedekleyin.
- Git'e eklenmez (`.gitignore`), kimseyle paylaşmayın.
- Google Play App Signing açık olacağı için bu bir *yükleme* anahtarıdır; kaybolursa Play Console'dan sıfırlama
  istenebilir, ama süreç günler sürer.

## Play Console adımları

1. **Hesap:** [play.google.com/console](https://play.google.com/console) (tek seferlik 25 $). Kişisel hesapta yayından
   önce **12 test kullanıcısıyla 14 gün kesintisiz kapalı test** zorunlu; kurum hesabında bu şart yok (D-U-N-S gerekir).
2. **Uygulama oluştur:** Ad "Kent Pusulası – İzmir", varsayılan dil Türkçe, Uygulama, Ücretsiz.
3. **Test › Kapalı test:** `dist-android/kent-pusulasi-1.0.0-play.aab` yükleyin, Play App Signing'i kabul edin,
   test kullanıcılarının e-postalarını ekleyin.
4. Aşağıdaki "Uygulama içeriği" formlarını doldurun.
5. 14 gün sonra **Üretim erişimi** başvurusu, ardından üretim sürümü.

## Mağaza metinleri

**Kısa açıklama (80 karakter):**
> İzmir'de en yakın eczane, toplanma alanı, su ve elektrik kesintisi tek haritada.

**Tam açıklama:**
> Kent Pusulası; İzmir'deki kent hizmetlerini tek haritada, size en yakından başlayarak gösterir.
>
> Bu uygulama bir devlet kurumunu temsil etmez. İzmir Büyükşehir Belediyesi, İZSU, AFAD veya EPİAŞ'ın resmî
> uygulaması değildir. Veriler şu resmî kaynaklardan alınır:
> • İzmir Büyükşehir Belediyesi Açık Veri Portalı: https://acikveri.bizizmir.com
> • İZSU arıza ve bakım bilgisi: https://www.izsu.gov.tr
> • AFAD Deprem Dairesi Başkanlığı: https://deprem.afad.gov.tr
> • EPİAŞ Şeffaflık Platformu: https://seffaflik.epias.com.tr
>
> • Nöbetçi eczaneler: araçla mesafe ve yol tarifiyle
> • Deprem toplanma alanları: yürüyerek en yakını, internet olmasa da
> • Aile buluşma noktası: deprem anında nerede buluşacağınızı belirleyin ve paylaşın
> • Su ve elektrik kesintileri: etkilenen mahalleler haritada
> • Otoparklar, semt pazarları, taksi durakları, ücretsiz Wi-Fi, hava kalitesi, son depremler
>
> Bilgiler bilgilendirme amaçlıdır. Acil durumda 112'yi arayın.

(Kaynak listesi ve "devleti temsil etmez" cümlesi Google Play'in devlet bilgisi kuralı gereği ilk paragraflarda.)

**Kategori:** Harita ve Navigasyon · **İletişim e-postası:** emirhanmetin12@gmail.com · **Gizlilik politikası:** `https://kent-pusulasi-api.onrender.com/gizlilik.html` (sunucu adresiniz farklıysa onunki)

**Görseller:** `../play-store/simge-512.png`, `../play-store/one-cikan-gorsel-1024x500.png` hazır; en az 2 telefon ekran görüntüsünü uygulamayı telefona kurup kendiniz alın.

## Uygulama içeriği formları

| Form | Cevap |
|---|---|
| Gizlilik politikası | `https://kent-pusulasi-api.onrender.com/gizlilik.html` |
| Uygulama erişimi | Tüm işlevler kısıtlama olmadan kullanılabilir (giriş yok) |
| Reklamlar | Hayır |
| İçerik derecelendirmesi | Anket: yardımcı program/navigasyon; şiddet, cinsellik, kumar vb. hepsi "Hayır" → beklenen: 3+ / Herkes |
| Hedef kitle | 18 yaş ve üzeri (13 yaş altını seçmek Aile politikası yükümlülükleri getirir) |
| Haber uygulaması | Hayır |
| Devlet uygulamaları beyanı | Uygulama bir devlet kurumu tarafından ya da adına geliştirilmedi |
| Finans / sağlık özellikleri | Yok |
| Konum izni | Yalnızca ön planda; arka plan konumu istenmiyor (beyan gerekmez) |

**Veri güvenliği (Data safety):**

| Veri türü | Toplanıyor mu | Paylaşılıyor mu | Not |
|---|---|---|---|
| Yaklaşık konum | Evet | Hayır | Uygulama işlevi; geçici işlenir, saklanmaz |
| Kesin konum | Evet | Hayır | Uygulama işlevi; geçici işlenir, saklanmaz |
| Diğer her şey | Hayır | — | Hesap, reklam, analitik, çökme raporu yok |

- Veriler aktarım sırasında şifreleniyor mu: **Evet** (https sunucu adresiyle derlendiyse).
- Kullanıcılar veri silme isteyebilir mi: Hesap olmadığı ve konum saklanmadığı için "Uygulama kullanıcı verisi saklamıyor".
- Anlık bildirimleri açtığınızda (FCM kurulduktan sonra) "Cihaz veya diğer kimlikler" kalemini ekleyin.
- Sentry/analitik eklerseniz formu güncelleyin; beyan ile davranış uyuşmazsa uygulama kaldırılabilir.

## Anlık bildirimleri açmak (sonraki adım)

1. [Firebase](https://console.firebase.google.com) projesi oluşturun, Android uygulaması ekleyin (`com.kentpusulasi.izmir`),
   `google-services.json` dosyasını bu klasöre koyun ve `app.json › android.googleServicesFile` ile gösterin.
2. `npx eas-cli@latest init` ile Expo proje kimliği alın (push anahtarı buna bağlı).
3. Firebase'den FCM v1 hizmet hesabı anahtarını Expo'ya yükleyin (`npx eas-cli credentials`).
4. Veri güvenliği formuna "Cihaz kimlikleri: bildirim anahtarı" ekleyin.
