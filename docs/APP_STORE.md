# App Store yayın rehberi

## 1. Kontrol listesi

**Sizin yapmanız gerekenler** (kodla çözülemez):
- [ ] Apple Developer Program üyeliği (bireysel, yıllık 99 $): https://developer.apple.com/programs/
- [ ] Sunucu (VPS, en az 2 vCPU / 4 GB bellek) ve alan adı. DNS A kaydı sunucuyu göstermeli.
- [ ] Sunucuda: `.env` doldur (`DOMAIN`, `EPIAS_*`), `sh scripts/osrm_hazirla.sh`, `docker compose up -d --build`
- [ ] `web/gizlilik.html` içindeki **[DOLDURUN]** alanları (ad, e-posta, sunucu ülkesi, hukuki dayanak) ve hukukçu kontrolü
- [ ] `mobile/eas.json` içindeki `EXPO_PUBLIC_API_URL` değerini gerçek adresle değiştirin
- [ ] EPİAŞ'tan verinin uygulamada gösterilmesi için yazılı teyit (önerilir)
- [ ] İZSU'dan kesinti sayfasının kullanımı için izin (önerilir)
- [ ] Anlık bildirimler için: `cd mobile && npx eas-cli@latest init` (projeye EAS kimliği ekler); ilk iOS derlemesinde EAS, Apple Push anahtarını oluşturmayı sorar → Evet
- [ ] (İsteğe bağlı) Expo hesabında "Enhanced Security for Push" açıksa erişim anahtarını sunucu `.env` dosyasına `EXPO_ACCESS_TOKEN` olarak yazın
- [ ] TestFlight ile en az bir gerçek iPhone'da deneme (anlık bildirimler Expo Go'da çalışmaz, TestFlight'ta denenmeli)

**Hazır olanlar:**
- [x] Yayın modunda sunucu (`KP_ENV=prod`): API belgesi kapalı, istek sınırı, güvenlik başlıkları, konum/IP yazmayan günlük
- [x] Kendi rota sunucusu kurulumu (OSRM, araç + yürüme). Genel FOSSGIS sunucuları yayında kullanılmaz
- [x] Üçüncü tarafa IP gönderen konum servisi varsayılan olarak kapalı
- [x] Uygulama içi Hakkında ekranı: 112, uyarı, veri kaynakları ve lisanslar, gizlilik politikası bağlantısı
- [x] Gizlilik politikası ve kaynaklar sayfaları: `https://<alan-adınız>/gizlilik.html`, `/kaynaklar.html`
- [x] EPİAŞ hesabı yoksa Elektrik menüsü gizlenir (yarım özellik görünmez)
- [x] Anlık bildirim sunucusu (su/elektrik kesintisi mahalleye göre, M4+ deprem); tekrar göndermez, geçersiz anahtarları siler
- [x] Çevrimdışı toplanma alanları ve kayıtlı yürüme rotası, aile buluşma noktası, favoriler, pazar ve aylık hazırlık hatırlatıcıları
- [x] Simge (1024×1024, saydamlıksız), açılış ekranı, `supportsTablet: false`, şifreleme beyanı (`usesNonExemptEncryption: false`)

## 2. Derleme ve gönderme (Mac gerekmez)

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --latest
```

EAS, sertifika ve provisioning işlemlerini Apple hesabınızla kendisi yönetir. Gönderimden sonra App Store Connect'te TestFlight'a düşer.

## 3. App Store Connect metinleri (öneri)

**Ad:** Kent Pusulası – İzmir
**Alt başlık:** Eczane, toplanma alanı, kesinti

**Açıklama:**
> Kent Pusulası, İzmir'deki kent hizmetlerini tek haritada, size en yakından başlayarak gösterir.
>
> • Nöbetçi eczaneler: araçla mesafe ve yol tarifiyle
> • Deprem toplanma alanları: yürüyerek en yakını, internet olmasa da
> • Su ve elektrik kesintileri: etkilenen mahalleler haritada
> • Otoparklar: kapasite, ücret, çalışma saati ve anlık boş yer bilgisi
> • Semt pazarları, taksi durakları, ücretsiz Wi-Fi ve hava kalitesi
>
> Veriler İzmir Büyükşehir Belediyesi Açık Veri Portalı, İZSU ve EPİAŞ Şeffaflık Platformu'ndan alınır. Kent Pusulası bu kurumların resmî uygulaması değildir. Bilgiler bilgilendirme amaçlıdır. Acil durumda 112'yi arayın.

**Anahtar kelimeler:** izmir,nöbetçi eczane,toplanma alanı,deprem,su kesintisi,elektrik kesintisi,otopark,pazar
**Kategori:** Navigasyon (ikincil: Yardımcı Araçlar)
**Yaş derecelendirmesi:** 4+

**İnceleme notları (App Review Notes):**
> This app shows public-service information for İzmir, Turkey (pharmacies on duty, earthquake assembly areas, utility outages, parking). No account is required. If the reviewer's location is outside İzmir, the app falls back to İzmir city centre (Konak), so all features remain testable. Long-press on the map to set a location manually. Data comes from official open-data sources listed under the (i) button. The app is informational and is not an emergency service; it points users to 112.

## 4. App Privacy (gizlilik etiketi) cevapları

| Veri türü | Toplanıyor mu? | Kullanıcıyla ilişkilendiriliyor mu? | İzleme (tracking) |
|---|---|---|---|
| Kesin konum | Evet, uygulama işlevi için | Hayır (saklanmaz, kimliksiz) | Hayır |
| Cihaz kimliği (bildirim anahtarı) | Yalnızca bildirimler açılırsa | Hayır (hesap yok) | Hayır |
| Diğer her şey | Hayır | – | – |

Bildirimler eklendiğinde "Kesin konum" yerine yalnızca seçilen **ilçe/mahalle** sunucuda saklanır. Konum sunucuda saklanmaz.
