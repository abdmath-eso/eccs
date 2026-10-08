# Builds the ECCS app into an Android APK on this PC, without Expo's cloud service.
#
# Run it from a PowerShell window with the mobile app's terminal (Expo) stopped:
#
#     cd C:\Users\eosfera\eccs\apps\mobile
#     .\build-apk.ps1
#
# The APK is written to  apps\mobile\ECCS-test.apk.  Copy that file to a phone and open it
# there to install, or add  -Install  to put it straight onto a phone connected by USB (or
# onto the virtual phone, if it is running).
#
# The address of the API is built into the APK. By default it is this PC's Wi-Fi address on
# port 4000, so the phone must be on the same Wi-Fi as the PC. To build for a different
# address:  .\build-apk.ps1 -ApiUrl "https://example.com/v1"
#
# The first build takes 10 to 30 minutes; later ones a few minutes. docs/APK_BUILD.md has more.

param(
  [string]$ApiUrl,
  [switch]$Install
)

# Not 'Stop': the build tools write ordinary progress to the error stream, which Windows
# PowerShell would then treat as a failure. Each step's exit code is checked instead.
$ErrorActionPreference = 'Continue'
$mobile = $PSScriptRoot
$repo = Resolve-Path (Join-Path $mobile '..\..')

# Node, as every other command in this project needs it.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
fnm env --shell powershell | Out-String | Invoke-Expression

# The Android SDK that Android Studio installed.
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not (Test-Path $env:ANDROID_HOME)) { throw "The Android SDK was not found at $env:ANDROID_HOME. Open Android Studio once and finish its setup." }

# Java 17. Android Studio's own Java (25) is too new for the step that compiles the app's
# native parts, which stops with "A restricted method in java.lang.System has been called".
# The build system downloads Java 17 for itself on the first build; use that one if it is there.
$java17 = Get-ChildItem (Join-Path $env:USERPROFILE '.gradle\jdks') -Directory -Filter '*17*' -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1
if ($java17) { $env:JAVA_HOME = $java17.FullName }
elseif (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
Write-Host "Java: $env:JAVA_HOME"

# Where the app will look for the API.
if (-not $ApiUrl) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  if (-not $ip) { throw 'Could not find this PC''s Wi-Fi address. Pass the API address yourself: .\build-apk.ps1 -ApiUrl "http://192.168.x.x:4000/v1"' }
  $ApiUrl = "http://${ip}:4000/v1"
}
$env:EXPO_PUBLIC_API_URL = $ApiUrl
# A plain "http://" address is only allowed when the build says so (see app.config.js).
if ($ApiUrl.StartsWith('http://')) { $env:ECCS_ALLOW_HTTP = '1' } else { $env:ECCS_ALLOW_HTTP = '0' }
$env:NODE_ENV = 'production'
$env:CI = '1'
Write-Host "API address built into the app: $ApiUrl"

# The shared packages the app imports (their built output is not kept in git).
Set-Location $repo
pnpm build --filter=@eccs/shared --filter=@eccs/i18n --filter=@eccs/api-client
if ($LASTEXITCODE -ne 0) { throw 'Building the shared packages failed.' }

# The Android project is generated from app.json and app.config.js each time, so it always
# matches them. It is not kept in git. This step rewrites two "scripts" lines in package.json,
# which are put back afterwards.
Set-Location $mobile
pnpm exec expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { throw 'Generating the Android project failed.' }
git checkout -- package.json

# Compile. arm64-v8a is for real phones, x86_64 for the virtual phone on this PC.
Set-Location (Join-Path $mobile 'android')
& .\gradlew.bat assembleRelease --console=plain '-PreactNativeArchitectures=arm64-v8a,x86_64'
if ($LASTEXITCODE -ne 0) { throw 'The Android build failed. The lines above say why.' }

$apk = Join-Path $mobile 'ECCS-test.apk'
Copy-Item (Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk') $apk -Force
Write-Host ''
Write-Host "Done. The APK is at $apk"

if ($Install) {
  $adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  & $adb install -r $apk
}
Set-Location $mobile
