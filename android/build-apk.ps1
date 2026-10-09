# build-apk.ps1 —— 手工构建 APK（aapt2 + javac + d8 + zipalign + apksigner）
# 零 Gradle、零网络依赖。产物：dist/wheel-lottery.apk
# 用法：在此目录执行  powershell -NoProfile -ExecutionPolicy Bypass -File .\build-apk.ps1

$ErrorActionPreference = 'Stop'
chcp 65001 > $null

$ProjectRoot = Split-Path -Parent $PSScriptRoot          # wheel-lottery/
$BuildDir    = Join-Path $PSScriptRoot 'build'
$DistDir     = Join-Path $PSScriptRoot 'dist'
$KeystoreDir = Join-Path $PSScriptRoot 'keystore'

# ---------- 定位工具链 ----------
$Sdk = $env:ANDROID_SDK_ROOT
if (-not $Sdk) { $Sdk = $env:ANDROID_HOME }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $Sdk)) { throw "Android SDK not found: $Sdk" }

$BtVersion  = '35.0.0'
$Bt         = Join-Path $Sdk "build-tools\$BtVersion"
$AndroidJar = Join-Path $Sdk 'platforms\android-35\android.jar'
$Aapt2      = Join-Path $Bt 'aapt2.exe'
$D8         = Join-Path $Bt 'd8.bat'
$Zipalign   = Join-Path $Bt 'zipalign.exe'
$Apksigner  = Join-Path $Bt 'apksigner.bat'
foreach ($t in @($Aapt2, $D8, $Zipalign, $Apksigner, $AndroidJar)) {
    if (-not (Test-Path $t)) { throw "missing tool: $t" }
}
$Javac = Join-Path $env:JAVA_HOME 'bin\javac.exe'
if (-not (Test-Path $Javac)) { $Javac = (Get-Command javac -ErrorAction Stop).Source }
$JarExe = Join-Path $env:JAVA_HOME 'bin\jar.exe'
if (-not (Test-Path $JarExe)) { $JarExe = (Get-Command jar -ErrorAction Stop).Source }

Write-Host "SDK        : $Sdk"
Write-Host "build-tools: $BtVersion"
Write-Host "JDK        : $env:JAVA_HOME"
Write-Host ''

# ---------- 0. 清理 ----------
foreach ($d in @($BuildDir, $DistDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $BuildDir, $DistDir, $KeystoreDir | Out-Null

# ---------- 1. 收集 Web 资源到 assets/www ----------
$AssetsDir = Join-Path $BuildDir 'assets\www'
New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null
foreach ($f in @('index.html', 'style.css', 'app.js', 'parser.js')) {
    Copy-Item (Join-Path $ProjectRoot $f) -Destination $AssetsDir
}
$VendorDst = Join-Path $AssetsDir 'vendor'
New-Item -ItemType Directory -Force -Path $VendorDst | Out-Null
Get-ChildItem (Join-Path $ProjectRoot 'vendor') -File | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $VendorDst $_.Name)
}
Write-Host '[1/6] web assets staged'

# ---------- 2. 编译 + 链接资源 ----------
Push-Location $PSScriptRoot
& $Aapt2 compile --dir res -o (Join-Path $BuildDir 'res.zip')
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'aapt2 compile failed' }

$BaseApk = Join-Path $BuildDir 'base.apk'
& $Aapt2 link `
    -o $BaseApk `
    -I $AndroidJar `
    --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') `
    --min-sdk-version 24 `
    --target-sdk-version 35 `
    --version-code 1 `
    --version-name '1.0.0' `
    (Join-Path $BuildDir 'res.zip')
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'aapt2 link failed' }
Pop-Location
Write-Host '[2/6] resources linked'

# ---------- 2b. 注入 assets/www ----------
# 这里不依赖任何外部打包工具的原因（都是 Windows 上实测踩到的坑）：
#  1) `aapt2 -A` 把条目名写成 assets/www\app.js（反斜杠）。ZIP 规范要求正斜杠，
#     Android AssetManager 读不到 → 安装后白屏。
#  2) `jar --create` 会重建整个 zip，丢掉 aapt2 写好的 AndroidManifest.xml。
#  3) `jar --update -C assets www` / `-C assets .` 前缀语义都不可靠（打成 www/...）。
# 所以直接用 .NET ZipArchive 显式写入我们指定的条目名：正斜杠 + assets 前缀。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$AssetsRoot = Join-Path $BuildDir 'assets'
$zip = [System.IO.Compression.ZipFile]::Open($BaseApk, 'Update')
try {
    foreach ($file in Get-ChildItem $AssetsRoot -Recurse -File) {
        $rel = $file.FullName.Substring($AssetsRoot.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry("assets/$rel")
        $s = $entry.Open()
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $s.Write($bytes, 0, $bytes.Length)
        $s.Close()
    }
} finally { $zip.Dispose() }
Write-Host '[2b/6] assets injected'

# ---------- 3. 编译 Java ----------
$ClassesDir = Join-Path $BuildDir 'classes'
New-Item -ItemType Directory -Force -Path $ClassesDir | Out-Null
$JavaFiles = Get-ChildItem (Join-Path $PSScriptRoot 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& $Javac -encoding UTF-8 -source 11 -target 11 -nowarn -classpath $AndroidJar -d $ClassesDir $JavaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
Write-Host '[3/6] java compiled'

# ---------- 4. dex + zipalign ----------
$DexDir = Join-Path $BuildDir 'dex'
New-Item -ItemType Directory -Force -Path $DexDir | Out-Null
$ClassFiles = Get-ChildItem $ClassesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $D8 --lib $AndroidJar --min-api 24 --output $DexDir $ClassFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($BaseApk, 'Update')
try {
    $s = $zip.CreateEntry('classes.dex').Open()
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $DexDir 'classes.dex'))
    $s.Write($bytes, 0, $bytes.Length); $s.Close()
} finally { $zip.Dispose() }
Write-Host '[4/6] dex injected'

$AlignedApk = Join-Path $BuildDir 'aligned.apk'
& $Zipalign -f 4 $BaseApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }
Write-Host '[5/6] aligned'

# ---------- 6. 签名 ----------
$Keystore = Join-Path $KeystoreDir 'wheel-debug.keystore'
if (-not (Test-Path $Keystore)) {
    Write-Host '      first build: generating debug keystore'
    & keytool -genkeypair -v -keystore $Keystore -storetype PKCS12 `
        -storepass android -keypass android -alias wheel `
        -keyalg RSA -keysize 2048 -validity 10950 `
        -dname 'CN=Lucky Wheel, OU=App, O=yumumo, C=CN' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

$OutApk = Join-Path $DistDir 'wheel-lottery.apk'
& $Apksigner sign --ks $Keystore --ks-pass pass:android --key-pass pass:android `
    --ks-key-alias wheel --min-sdk-version 24 --out $OutApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed' }
& $Apksigner verify --min-sdk-version 24 $OutApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner verify failed' }

# ---------- 7. 构建后自检：坏 APK 不许流出去 ----------
$zv = [System.IO.Compression.ZipFile]::OpenRead($OutApk)
$names = $zv.Entries | ForEach-Object { $_.FullName }
$zv.Dispose()
$problems = @()
if ($names -match '\\') { $problems += 'backslash in entry name (AssetManager cannot read)' }
foreach ($required in @('AndroidManifest.xml', 'resources.arsc', 'classes.dex',
                        'assets/www/index.html', 'assets/www/app.js',
                        'assets/www/style.css', 'assets/www/parser.js',
                        'assets/www/vendor/xlsx.full.min.js', 'assets/www/vendor/jszip.min.js')) {
    if ($names -notcontains $required) { $problems += "missing: $required" }
}
if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'APK SELF-CHECK FAILED:'
    $problems | ForEach-Object { Write-Host "  - $_" }
    throw 'apk self-check failed'
}

$sizeMB = [math]::Round((Get-Item $OutApk).Length / 1MB, 2)
Write-Host ''
Write-Host "OK  ->  $OutApk  ($sizeMB MB, $($names.Count) entries, self-check passed)"
Write-Host ''
Write-Host 'install:'
Write-Host "  adb install -r `"$OutApk`""
