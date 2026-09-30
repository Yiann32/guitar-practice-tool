$ErrorActionPreference = 'Stop'

$env:JAVA_HOME = 'C:\Users\Unknow\.jdks\jbr-21.0.11'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'

Write-Host 'Building web assets...'
npm run build

Write-Host 'Syncing Capacitor Android project...'
npx cap sync android

Write-Host 'Building debug APK...'
Push-Location android
try {
  .\gradlew.bat assembleDebug --no-daemon --console=plain --init-script gradle-mirror.init.gradle
} finally {
  Pop-Location
}

$apk = Join-Path $PWD 'android\app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
  Copy-Item -LiteralPath $apk -Destination 'downloads\guitar-practice-debug.apk' -Force
  Write-Host "APK: $apk"
  Write-Host "Copied: downloads\guitar-practice-debug.apk"
} else {
  throw 'APK was not generated.'
}
