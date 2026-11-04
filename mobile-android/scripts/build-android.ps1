<#
Kent Pusulası Android sürümünü bu bilgisayarda derler ve imzalar.

  Google Play'e yüklenecek paket (AAB):
    .\scripts\build-android.ps1 -ApiUrl https://api.alanadiniz.com.tr -Target aab -VersionCode 2

  Telefona elle kurulacak test paketi (APK), yerel ağdaki sunucuya bağlanır ("python serve.py --lan"):
    .\scripts\build-android.ps1 -ApiUrl http://192.168.1.6:8000 -Target apk

Çıktılar proje kökündeki dist-android\ klasörüne yazılır.

Gerekenler: Node.js, JDK 21, Android SDK (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1)
ve credentials\keystore.properties + credentials\upload-keystore.jks (yükleme anahtarı).
Proje yolunda Türkçe karakter olduğu için derleme %USERPROFILE%\kpb kopyasında yapılır.
#>
param(
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [ValidateSet('apk', 'aab', 'both')][string]$Target = 'both',
  [int]$VersionCode = 0
)
$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot           # ...\mobile-android
$root = Split-Path -Parent $project                   # proje kökü
$dist = Join-Path $root 'dist-android'

if ($ApiUrl.StartsWith('http://') -and $Target -ne 'apk') {
  throw 'Google Play paketi (AAB) https adresiyle derlenmelidir. http yalnızca yerel ağ testi (APK) içindir.'
}
if ($ApiUrl -match 'ORNEK|alanadiniz|example\.|localhost|127\.0\.0\.1') {
  throw "API adresi örnek/yerel görünüyor ($ApiUrl): Play paketi gerçek sunucu adresiyle derlenmelidir."
}
if (-not (Test-Path (Join-Path $project 'credentials\keystore.properties'))) {
  throw 'credentials\keystore.properties bulunamadı: yayın imzası olmadan Play paketi üretilemez.'
}

if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Java\jdk-21' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:EXPO_PUBLIC_API_URL = $ApiUrl.TrimEnd('/')
if ($VersionCode -gt 0) { $env:KP_VERSION_CODE = "$VersionCode" }
$env:CI = '1'

# Metro, EXPO_PUBLIC_API_URL'i pakete gömülmüş haliyle önbelleğe alıyor. Ortak %TEMP%\metro-cache kullanılırsa
# önceki derlemenin adresi yeni pakete girebiliyor (klasör kilitliyse --reset-cache de temizleyemiyor).
# Bu yüzden her derleme kendi boş geçici klasörünü kullanır.
$tmp = Join-Path $env:USERPROFILE 'kpb-tmp'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp

# Android araçları (Gradle, NDK, codegen) Türkçe karakterli ve boşluklu yollarda bozuluyor; subst da işe
# yaramıyor (Node gerçek yolu çözüyor). Bu yüzden proje kısa bir ASCII klasöre eşitlenip orada derlenir.
$work = Join-Path $env:USERPROFILE 'kpb'
# Yalnızca projenin kendi android\ ve .expo\ klasörleri atlanır (node_modules içindeki android\ klasörleri gerekli)
robocopy $project $work /MIR /XD (Join-Path $project 'android') (Join-Path $project '.expo') /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Derleme klasörüne kopyalama başarısız' }

Push-Location $work
try {
  Write-Host "API adresi: $env:EXPO_PUBLIC_API_URL"
  npx expo prebuild -p android --clean --no-install
  if ($LASTEXITCODE) { throw 'prebuild başarısız' }

  Set-Content -Path 'android\local.properties' -Value ("sdk.dir=" + $env:ANDROID_HOME.Replace('\', '\\'))
  $gradleArgs = @('--no-daemon', '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g')
  New-Item -ItemType Directory -Force $dist | Out-Null
  $version = (Get-Content 'app.json' -Raw | ConvertFrom-Json).expo.version

  Push-Location android
  try {
    # Pakete gömülen sunucu adresi verilenle aynı olmalı; değilse yanlış sunucuya bağlanan paket üretilmesin.
    $assertApiUrl = {
      $bundle = 'app\build\generated\assets\react\release\index.android.bundle'
      if (-not (Select-String -Path $bundle -Pattern $env:EXPO_PUBLIC_API_URL -SimpleMatch -Quiet)) {
        throw "JS paketinde API adresi ($env:EXPO_PUBLIC_API_URL) bulunamadı: eski önbellekten derlenmiş olabilir."
      }
    }
    if ($Target -in 'aab', 'both') {
      .\gradlew.bat bundleRelease @gradleArgs '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64'
      if ($LASTEXITCODE) { throw 'bundleRelease başarısız' }
      & $assertApiUrl
      Copy-Item 'app\build\outputs\bundle\release\app-release.aab' (Join-Path $dist "kent-pusulasi-$version-play.aab") -Force
    }
    if ($Target -in 'apk', 'both') {
      .\gradlew.bat assembleRelease @gradleArgs '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64'
      if ($LASTEXITCODE) { throw 'assembleRelease başarısız' }
      & $assertApiUrl
      $suffix = if ($ApiUrl.StartsWith('http://')) { 'yerel-test' } else { 'release' }
      Copy-Item 'app\build\outputs\apk\release\app-release.apk' (Join-Path $dist "kent-pusulasi-$version-$suffix.apk") -Force
    }
  } finally { Pop-Location }
  Get-ChildItem $dist | Format-Table Name, Length, LastWriteTime
} finally { Pop-Location }
