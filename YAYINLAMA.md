# Kent Pusulası — Google Play'e yayın kontrol listesi

Uygulama paketi hazır: `dist-android/kent-pusulasi-1.0.0-play.aab` (Play'e yüklenecek dosya) ve
`dist-android/kent-pusulasi-1.0.0-release.apk` (telefona elle kurup denemek için). İkisi de yükleme anahtarıyla
imzalı ve **`https://kent-pusulasi-api.onrender.com`** sunucusuna bağlanacak şekilde derlendi.

Uygulama tüm verisini bu sunucudan alır. **Sunucu açılmadan Play'e göndermeyin**: inceleme ekibi boş ekran görürse
uygulamayı "çalışmıyor" gerekçesiyle reddeder.

## 1. Sunucuyu yayına alın (Render, ~10 dk)

1. Proje klasörünü GitHub'a özel (private) bir depo olarak yükleyin. `.env`, `mobile-android/credentials/` ve
   `.venv` `.gitignore`'da; yine de yüklemeden önce bu dosyaların depoda olmadığını kontrol edin.
2. [render.com](https://render.com) › GitHub ile giriş › **New › Blueprint** › depoyu seçin. `render.yaml` okunur.
3. Servis adı **kent-pusulasi-api** olarak kalsın. İstenince `EPIAS_USERNAME` / `EPIAS_PASSWORD` değerlerini
   kendi `.env` dosyanızdan girin.
4. Plan: **Starter** (aylık ~7 $) önerilir. Ücretsiz plan 15 dk boşta kalınca uyur; ilk açılış ~1 dk sürer ve
   incelemede "uygulama açılmıyor" izlenimi verebilir.
5. Kurulum bitince tarayıcıda açın, ikisi de çalışmalı:
   - `https://kent-pusulasi-api.onrender.com/api/katmanlar`
   - `https://kent-pusulasi-api.onrender.com/gizlilik.html`

**Adres farklı çıkarsa** (ad başkası tarafından alınmışsa) paketi yeni adresle yeniden derleyin:

```powershell
cd mobile-android
.\scripts\build-android.ps1 -ApiUrl https://SIZIN-ADRESINIZ -Target both -VersionCode 1
```

## 2. Telefonda deneyin

`dist-android/kent-pusulasi-1.0.0-release.apk` dosyasını telefona atıp kurun (bilinmeyen kaynaklara izin verin).
Eczane, toplanma alanı, kesintiler, rota, Hakkında › Gizlilik politikası bağlantısı açılıyor mu bakın.
Bu sırada **en az 2 ekran görüntüsü** alın (mağaza için zorunlu).

## 3. Play Console

1. [play.google.com/console](https://play.google.com/console) geliştirici hesabı (tek seferlik 25 $, kimlik doğrulama).
2. **Uygulama oluştur:** "Kent Pusulası – İzmir", Türkçe, Uygulama, Ücretsiz.
3. **Mağaza girişi:** metinler `mobile-android/GOOGLE_PLAY.md` › "Mağaza metinleri"; görseller `play-store/`
   (512 simge, 1024×500 öne çıkan görsel) + telefon ekran görüntüleri.
4. **Uygulama içeriği** formları: `mobile-android/GOOGLE_PLAY.md` › "Uygulama içeriği formları" ve "Veri güvenliği"
   tablolarındaki cevapları birebir girin. Gizlilik politikası: `https://kent-pusulasi-api.onrender.com/gizlilik.html`.
5. **Test › Kapalı test:** AAB'yi yükleyin, Play App Signing'i kabul edin, **en az 12 test kullanıcısı** ekleyin.
   Kişisel hesaplarda üretime geçmeden önce 12 kişinin **14 gün** kesintisiz test etmesi zorunludur.
6. 14 gün sonra **Üretim erişimi başvurusu** › onaylanınca aynı AAB'yi üretime gönderin.

## Sonraki sürümler

Her yüklemede `-VersionCode` bir artmalı (2, 3, …); sürüm adını `mobile-android/app.json › version` ile değiştirin.

## Yedekleyin

`mobile-android/credentials/upload-keystore.jks` ve `keystore.properties` olmadan güncelleme yükleyemezsiniz.
Şimdi şifreli bir yere (parola yöneticisi, şifreli USB) kopyalayın.
