// app.json'u derleme ortamına göre tamamlar (Continuous Native Generation: android/ klasörü buradan üretilir).
//
//   EXPO_PUBLIC_API_URL   Python API adresi. Yayında https olmalı; http verilirse (yerel ağ testi) şifresiz
//                         bağlantıya izin verilir. Google Play sürümünde http KULLANMAYIN.
//   KP_VERSION_CODE       Play'e her yüklemede bir artırılmalı (varsayılan app.json'daki değer).
//
// Yayın imzası credentials/keystore.properties dosyasından okunur (bkz. scripts/build-android.ps1).
const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

const withCleartext = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });

const SIGNING_MARK = '// kp-release-signing';

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    if (gradle.includes(SIGNING_MARK)) return c;
    const loader = `${SIGNING_MARK}
def kpKeystorePropsFile = rootProject.file("../credentials/keystore.properties")
def kpKeystoreProps = new Properties()
if (kpKeystorePropsFile.exists()) { kpKeystorePropsFile.withInputStream { kpKeystoreProps.load(it) } }
`;
    gradle = gradle.replace(/^android \{/m, `${loader}\nandroid {`);
    gradle = gradle.replace(
      /signingConfigs \{\s*debug \{/,
      `signingConfigs {
        release {
            if (kpKeystorePropsFile.exists()) {
                storeFile rootProject.file("../credentials/" + kpKeystoreProps["storeFile"])
                storePassword kpKeystoreProps["storePassword"]
                keyAlias kpKeystoreProps["keyAlias"]
                keyPassword kpKeystoreProps["keyPassword"]
            }
        }
        debug {`,
    );
    // release derlemesi hata ayıklama anahtarıyla değil, yükleme anahtarıyla imzalanır
    gradle = gradle.replace(
      /(release \{[^}]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig kpKeystorePropsFile.exists() ? signingConfigs.release : signingConfigs.debug',
    );
    c.modResults.contents = gradle;
    return c;
  });

module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const versionCode = Number(process.env.KP_VERSION_CODE) || config.android.versionCode;
  config.android = { ...config.android, versionCode };
  config.extra = { ...config.extra, apiUrl };
  config = withReleaseSigning(config);
  if (apiUrl.startsWith('http://')) config = withCleartext(config);
  return config;
};
