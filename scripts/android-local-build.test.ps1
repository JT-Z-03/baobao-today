$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'android-local-build.ps1'
$testRoot = Join-Path $env:TEMP "baobao-android-build-test-$([guid]::NewGuid().ToString('N'))"
$originalEnvironment = @{
  JAVA_HOME = $env:JAVA_HOME
  ANDROID_HOME = $env:ANDROID_HOME
  ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT
  BAOBAO_ANDROID_BUILD_ROOT = $env:BAOBAO_ANDROID_BUILD_ROOT
  BAOBAO_GRADLE_ZIP = $env:BAOBAO_GRADLE_ZIP
  BAOBAO_GRADLE_SHA256 = $env:BAOBAO_GRADLE_SHA256
  BAOBAO_ANDROID_KEY_PROPERTIES = $env:BAOBAO_ANDROID_KEY_PROPERTIES
  NODE_ENV = $env:NODE_ENV
  PATH = $env:PATH
}

function Assert-Equal([string]$label, [string]$actual, [string]$expected) {
  if ($actual -ne $expected) {
    throw "$label expected '$expected', received '$actual'"
  }
}

function Get-PngHeader([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $signature = @(137, 80, 78, 71, 13, 10, 26, 10)
  for ($index = 0; $index -lt $signature.Count; $index += 1) {
    if ($bytes[$index] -ne $signature[$index]) {
      throw "Brand asset is not a PNG: $Path"
    }
  }
  $width = ([int]$bytes[16] -shl 24) -bor ([int]$bytes[17] -shl 16) `
    -bor ([int]$bytes[18] -shl 8) -bor [int]$bytes[19]
  $height = ([int]$bytes[20] -shl 24) -bor ([int]$bytes[21] -shl 16) `
    -bor ([int]$bytes[22] -shl 8) -bor [int]$bytes[23]
  $hasSrgb = $false
  $chunkOffset = 8
  while ($chunkOffset + 12 -le $bytes.Length) {
    $chunkLength = ([int]$bytes[$chunkOffset] -shl 24) -bor ([int]$bytes[$chunkOffset + 1] -shl 16) `
      -bor ([int]$bytes[$chunkOffset + 2] -shl 8) -bor [int]$bytes[$chunkOffset + 3]
    $chunkType = [Text.Encoding]::ASCII.GetString($bytes, $chunkOffset + 4, 4)
    if ($chunkType -eq 'sRGB') { $hasSrgb = $true }
    $chunkOffset += 12 + $chunkLength
    if ($chunkType -eq 'IEND') { break }
  }
  return [pscustomobject]@{
    Width = $width
    Height = $height
    BitDepth = [int]$bytes[24]
    ColorType = [int]$bytes[25]
    HasSrgb = $hasSrgb
  }
}

function Assert-SmallRasterVisible([string]$Path, [int[]]$Sizes) {
  Add-Type -AssemblyName System.Drawing
  $source = [Drawing.Bitmap]::FromFile($Path)
  try {
    foreach ($size in $Sizes) {
      $preview = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [Drawing.Graphics]::FromImage($preview)
      try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }

      $visible = 0
      $minX = $size
      $minY = $size
      $maxX = -1
      $maxY = -1
      for ($y = 0; $y -lt $size; $y += 1) {
        for ($x = 0; $x -lt $size; $x += 1) {
          if ($preview.GetPixel($x, $y).A -lt 16) { continue }
          $visible += 1
          if ($x -lt $minX) { $minX = $x }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
      $preview.Dispose()

      if ($visible -lt [Math]::Ceiling($size * $size * 0.04)) {
        throw "$Path is not legible at ${size}px: insufficient visible area"
      }
      if ($minX -lt 2 -or $minY -lt 2 -or $maxX -gt $size - 3 -or $maxY -gt $size - 3) {
        throw "$Path is clipped or lacks margin at ${size}px"
      }
    }
  } finally {
    $source.Dispose()
  }
}

function Get-PngPixelStats([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  $source = [Drawing.Bitmap]::FromFile($Path)
  $bitmap = New-Object Drawing.Bitmap(
    $source.Width,
    $source.Height,
    [Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.DrawImageUnscaled($source, 0, 0)
  $source.Dispose()
  $graphics.Dispose()

  $rectangle = New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $data = $bitmap.LockBits(
    $rectangle,
    [Drawing.Imaging.ImageLockMode]::ReadOnly,
    [Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $stride = [Math]::Abs($data.Stride)
  $pixels = New-Object byte[] ($stride * $bitmap.Height)
  [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
  $bitmap.UnlockBits($data)
  $bitmap.Dispose()

  $minX = $rectangle.Width
  $minY = $rectangle.Height
  $maxX = -1
  $maxY = -1
  $nonTransparent = 0
  $partialAlpha = 0
  $nonWhiteVisible = 0
  $darkPartial = 0
  $cornerPixels = @{}
  foreach ($point in @(
    @{ Name = 'top-left'; X = 0; Y = 0 },
    @{ Name = 'top-right'; X = $rectangle.Width - 1; Y = 0 },
    @{ Name = 'bottom-left'; X = 0; Y = $rectangle.Height - 1 },
    @{ Name = 'bottom-right'; X = $rectangle.Width - 1; Y = $rectangle.Height - 1 }
  )) {
    $offset = ($point.Y * $stride) + ($point.X * 4)
    $cornerPixels[$point.Name] = [pscustomobject]@{
      R = [int]$pixels[$offset + 2]
      G = [int]$pixels[$offset + 1]
      B = [int]$pixels[$offset]
      A = [int]$pixels[$offset + 3]
    }
  }

  for ($y = 0; $y -lt $rectangle.Height; $y += 1) {
    for ($x = 0; $x -lt $rectangle.Width; $x += 1) {
      $offset = ($y * $stride) + ($x * 4)
      $blue = [int]$pixels[$offset]
      $green = [int]$pixels[$offset + 1]
      $red = [int]$pixels[$offset + 2]
      $alpha = [int]$pixels[$offset + 3]
      if ($alpha -eq 0) { continue }
      $nonTransparent += 1
      if ($alpha -lt 255) {
        $partialAlpha += 1
        # Ignore near-transparent premultiplication noise; visible dark fringes
        # remain detectable once alpha reaches an on-screen level.
        if ($alpha -ge 32 -and [Math]::Max($red, [Math]::Max($green, $blue)) -lt 24) {
          $darkPartial += 1
        }
      }
      # GDI+ returns premultiplied RGB for antialiased transparent pixels.
      # Only opaque pixels can be compared to the PNG's intended white shape here.
      if ($alpha -eq 255 -and ($red -ne 255 -or $green -ne 255 -or $blue -ne 255)) {
        $nonWhiteVisible += 1
      }
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }

  return [pscustomobject]@{
    Bounds = [pscustomobject]@{ MinX = $minX; MinY = $minY; MaxX = $maxX; MaxY = $maxY }
    NonTransparent = $nonTransparent
    PartialAlpha = $partialAlpha
    NonWhiteVisible = $nonWhiteVisible
    DarkPartial = $darkPartial
    Corners = $cornerPixels
  }
}

function Assert-BrandPng(
  [string]$RelativePath,
  [int]$ExpectedColorType,
  [switch]$TransparentCorners,
  [switch]$AdaptiveSafeZone,
  [switch]$Monochrome
) {
  $path = Join-Path $sourceRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required Stage 4B brand asset is missing: $RelativePath"
  }
  $header = Get-PngHeader $path
  Assert-Equal "$RelativePath width" ([string]$header.Width) '1024'
  Assert-Equal "$RelativePath height" ([string]$header.Height) '1024'
  Assert-Equal "$RelativePath bit depth" ([string]$header.BitDepth) '8'
  Assert-Equal "$RelativePath PNG color type" ([string]$header.ColorType) ([string]$ExpectedColorType)
  Assert-Equal "$RelativePath sRGB profile marker" ([string]$header.HasSrgb) 'True'

  $stats = Get-PngPixelStats $path
  if ($TransparentCorners) {
    foreach ($corner in $stats.Corners.Values) {
      Assert-Equal "$RelativePath transparent corner alpha" ([string]$corner.A) '0'
    }
    if ($stats.NonTransparent -eq 0 -or $stats.PartialAlpha -eq 0) {
      throw "$RelativePath must contain an antialiased visible mark"
    }
  } else {
    foreach ($corner in $stats.Corners.Values) {
      Assert-Equal "$RelativePath opaque corner alpha" ([string]$corner.A) '255'
      if ($corner.R -lt 160 -or $corner.G -lt 80 -or $corner.B -gt 160) {
        throw "$RelativePath contains a dark, black, or non-brand corner"
      }
    }
  }
  if ($AdaptiveSafeZone) {
    if ($stats.Bounds.MinX -lt 199 -or $stats.Bounds.MinY -lt 199 `
      -or $stats.Bounds.MaxX -gt 824 -or $stats.Bounds.MaxY -gt 824) {
      throw "$RelativePath visible bounds exceed the central 626x626 adaptive safe zone"
    }
  }
  if ($Monochrome -and $stats.NonWhiteVisible -ne 0) {
    throw "$RelativePath must use one opaque white RGB shape and alpha-only antialiasing"
  }
  if (-not $Monochrome -and $TransparentCorners -and $stats.DarkPartial -gt 0) {
    throw "$RelativePath contains dark RGB contamination in partially transparent edge pixels"
  }
}

try {
  $scriptContent = Get-Content -Raw -LiteralPath $scriptPath
  if ($scriptContent -notmatch '\[switch\]\$DryRun') {
    throw 'DryRun parameter is not implemented'
  }
  if ($scriptContent -notmatch '\&\s+\$gradleWrapper\s+''--project-dir''\s+\$androidProjectRoot') {
    throw 'Release Gradle invocation does not set the generated Android project directory'
  }

  $sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $appConfig = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'app.json') -Encoding UTF8 | ConvertFrom-Json
  Assert-Equal 'Expo version' ([string]$appConfig.expo.version) '1.2.1'
  Assert-Equal 'Android versionCode' ([string]$appConfig.expo.android.versionCode) '9'
  Assert-Equal 'Universal icon path' ([string]$appConfig.expo.icon) './assets/images/icon.png'
  Assert-Equal 'Adaptive foreground path' ([string]$appConfig.expo.android.adaptiveIcon.foregroundImage) `
    './assets/images/android-icon-foreground.png'
  Assert-Equal 'Adaptive background path' ([string]$appConfig.expo.android.adaptiveIcon.backgroundImage) `
    './assets/images/android-icon-background.png'
  Assert-Equal 'Adaptive monochrome path' ([string]$appConfig.expo.android.adaptiveIcon.monochromeImage) `
    './assets/images/android-icon-monochrome.png'
  Assert-Equal 'Adaptive fallback background color' ([string]$appConfig.expo.android.adaptiveIcon.backgroundColor) '#FDC41A'

  $splashPlugin = @($appConfig.expo.plugins | Where-Object {
    $_ -is [Array] -and $_[0] -eq 'expo-splash-screen'
  })[0]
  if (-not $splashPlugin) { throw 'expo-splash-screen config plugin is missing' }
  $splashConfig = $splashPlugin[1]
  Assert-Equal 'Light splash image' ([string]$splashConfig.image) './assets/images/splash-icon.png'
  Assert-Equal 'Light splash background' ([string]$splashConfig.backgroundColor) '#F5F7F4'
  Assert-Equal 'Dark splash image' ([string]$splashConfig.dark.image) './assets/images/splash-icon-dark.png'
  Assert-Equal 'Dark splash background' ([string]$splashConfig.dark.backgroundColor) '#101311'
  Assert-Equal 'Splash imageWidth' ([string]$splashConfig.imageWidth) '160'
  Assert-Equal 'Splash resizeMode' ([string]$splashConfig.resizeMode) 'contain'
  foreach ($blockedPermission in @(
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW'
  )) {
    if (@($appConfig.expo.android.blockedPermissions) -notcontains $blockedPermission) {
      throw "Android blockedPermissions does not remove $blockedPermission"
    }
  }

  $temporaryVisualBoundaryBase64 = '5Li05pe26KeG6KeJ6LWE5Lqn77yM5LiN6Zi75aGecmVsZWFzZeaKgOacr+mqjOaUtu+8jOS9humYu+WhnuacgOe7iOWFrOW8gOWPkeW4g+OAgg=='
  $temporaryVisualBoundary = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($temporaryVisualBoundaryBase64)
  )
  $handoffPath = Join-Path $sourceRoot 'docs\handoffs\stage-4a-android-release.md'
  $handoffContent = Get-Content -Raw -LiteralPath $handoffPath -Encoding UTF8
  if ($handoffContent -notmatch [regex]::Escape($temporaryVisualBoundary)) {
    throw 'Stage 4A handoff does not record the temporary visual release boundary'
  }

  $acceptancePath = Join-Path $sourceRoot 'docs\engineering\stage-4a-android-release-acceptance.md'
  if (-not (Test-Path -LiteralPath $acceptancePath -PathType Leaf)) {
    throw 'Stage 4A Android release acceptance document is missing'
  }
  $acceptanceContent = Get-Content -Raw -LiteralPath $acceptancePath -Encoding UTF8
  if ($acceptanceContent -notmatch [regex]::Escape($temporaryVisualBoundary)) {
    throw 'Stage 4A acceptance does not record the temporary visual release boundary'
  }
  $requiredConclusionBase64 = 'U3RhZ2UgNEEgQW5kcm9pZCByZWxlYXNl5bel56iL5LiO54us56uL6L+Q6KGM6aqM5pS26YCa6L+H77yM5q2j5byP5ZOB54mM5Zu+5qCH5ZKM5ZCv5Yqo55S76Z2i5LuN5b6F5pu/5o2i44CC'
  $requiredConclusion = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($requiredConclusionBase64))
  if ($acceptanceContent -notmatch [regex]::Escape($requiredConclusion)) {
    throw 'Stage 4A acceptance does not preserve the required limited conclusion'
  }

  $knownExpoTemplateHashes = [ordered]@{
    'assets\images\icon.png' = '7a667804bb80a6a424a5daf18a2599c4f32237cf06fe78fc0de45dbb09e0eccf'
    'assets\images\android-icon-foreground.png' = '9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceB7240b391'
    'assets\images\android-icon-background.png' = 'fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d'
    'assets\images\android-icon-monochrome.png' = '6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83'
    'assets\images\splash-icon.png' = '27b060a757a29038c9618586baa0ba3894dbe60d084c6059df497ff429c2d92f'
  }
  foreach ($entry in $knownExpoTemplateHashes.GetEnumerator()) {
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $sourceRoot $entry.Key) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -eq $entry.Value.ToLowerInvariant()) {
      throw "Stage 4B brand asset still matches the known Expo template: $($entry.Key)"
    }
  }

  Assert-BrandPng 'assets\images\icon.png' 2
  Assert-BrandPng 'assets\images\android-icon-foreground.png' 6 -TransparentCorners -AdaptiveSafeZone
  Assert-BrandPng 'assets\images\android-icon-background.png' 2
  Assert-BrandPng 'assets\images\android-icon-monochrome.png' 6 -TransparentCorners -AdaptiveSafeZone -Monochrome
  Assert-BrandPng 'assets\images\splash-icon.png' 6 -TransparentCorners
  Assert-BrandPng 'assets\images\splash-icon-dark.png' 6 -TransparentCorners
  foreach ($smallPreviewAsset in @(
    'assets\images\android-icon-foreground.png',
    'assets\images\android-icon-monochrome.png',
    'assets\images\splash-icon.png',
    'assets\images\splash-icon-dark.png'
  )) {
    Assert-SmallRasterVisible (Join-Path $sourceRoot $smallPreviewAsset) @(24, 32, 48, 96)
  }

  $javaHome = Join-Path $testRoot 'jdk-17'
  $androidSdkRoot = Join-Path $testRoot 'android-sdk'
  $buildRoot = Join-Path $testRoot 'baobao-today-build'
  $gradleZip = Join-Path $testRoot 'gradle.zip'

  New-Item -ItemType Directory -Path (Join-Path $javaHome 'bin') -Force | Out-Null
  $platformTools = Join-Path $androidSdkRoot 'platform-tools'
  New-Item -ItemType Directory -Path $platformTools -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $javaHome 'bin\java.exe') -Force | Out-Null
  @'
@echo off
if "%1"=="devices" (
  echo List of devices attached
  echo AUTO_DEVICE device
  exit /b 0
)
exit /b 1
'@ | Set-Content -LiteralPath (Join-Path $platformTools 'adb.cmd') -Encoding ASCII
  Set-Content -LiteralPath $gradleZip -Value 'test-gradle-archive' -Encoding ASCII
  $gradleSha256 = (Get-FileHash -LiteralPath $gradleZip -Algorithm SHA256).Hash.ToLowerInvariant()

  $env:JAVA_HOME = $javaHome
  $env:ANDROID_HOME = $androidSdkRoot
  $env:ANDROID_SDK_ROOT = ''
  $env:BAOBAO_ANDROID_BUILD_ROOT = $buildRoot
  $env:BAOBAO_GRADLE_ZIP = $gradleZip
  $env:BAOBAO_GRADLE_SHA256 = $gradleSha256
  $env:PATH = "$platformTools;$($env:PATH)"

  $result = (& $scriptPath -Device 'TEST_DEVICE' -DryRun | ConvertFrom-Json)

  Assert-Equal 'JavaHome' $result.JavaHome $javaHome
  Assert-Equal 'AndroidSdkRoot' $result.AndroidSdkRoot $androidSdkRoot
  Assert-Equal 'BuildRoot' $result.BuildRoot $sourceRoot
  Assert-Equal 'GradleZip' $result.GradleZip $gradleZip
  Assert-Equal 'Device' $result.Device 'TEST_DEVICE'
  Assert-Equal 'Mode' $result.Mode 'dry-run'

  $autoDeviceResult = (& $scriptPath -DryRun | ConvertFrom-Json)
  Assert-Equal 'Auto-detected device' $autoDeviceResult.Device 'AUTO_DEVICE'

  $explicitBuildRoot = $sourceRoot
  $explicitResult = (& $scriptPath -Device 'EXPLICIT_DEVICE' -BuildRoot $explicitBuildRoot -JavaHome $javaHome `
    -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip -GradleSha256 $gradleSha256 -DryRun | ConvertFrom-Json)
  Assert-Equal 'Explicit build root' $explicitResult.BuildRoot $explicitBuildRoot
  Assert-Equal 'Explicit device' $explicitResult.Device 'EXPLICIT_DEVICE'

  $releaseWithoutPropertiesRejected = $false
  try {
    & $scriptPath -Release -BuildRoot $explicitBuildRoot -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot `
      -GradleZip $gradleZip -GradleSha256 $gradleSha256 -DryRun | Out-Null
  } catch {
    $releaseWithoutPropertiesRejected = $_.Exception.Message -match 'key.properties is required for release builds'
  }
  if (-not $releaseWithoutPropertiesRejected) {
    throw 'Release build without key.properties was not rejected'
  }

  $testKeystore = Join-Path $testRoot 'baobao-today-release.jks'
  $keyProperties = Join-Path $testRoot 'key.properties'
  New-Item -ItemType File -Path $testKeystore -Force | Out-Null
  @(
    "storeFile=$($testKeystore -replace '\\', '/')"
    'storePassword=TEST_STORE_PASSWORD'
    'keyAlias=baobao-today-release'
    'keyPassword=TEST_KEY_PASSWORD'
  ) | Set-Content -LiteralPath $keyProperties -Encoding ASCII

  $releaseResultJson = & $scriptPath -Release -KeyPropertiesPath $keyProperties -BuildRoot $explicitBuildRoot `
    -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
    -GradleSha256 $gradleSha256 -DryRun
  if ($releaseResultJson -match 'TEST_STORE_PASSWORD|TEST_KEY_PASSWORD') {
    throw 'Release dry-run output leaked a signing password'
  }
  $releaseResult = $releaseResultJson | ConvertFrom-Json
  Assert-Equal 'Release dry-run mode' $releaseResult.Mode 'release-dry-run'
  Assert-Equal 'Release key configured' ([string]$releaseResult.KeyPropertiesConfigured) 'True'
  Assert-Equal 'Release versionName' ([string]$releaseResult.VersionName) '1.2.1'
  Assert-Equal 'Release versionCode' ([string]$releaseResult.VersionCode) '9'
  Assert-Equal 'Release Gradle tasks' ($releaseResult.GradleTasks -join ',') ':app:assembleRelease,:app:bundleRelease'

  # Use the production encoder so the preflight reads the same format Gradle receives.
  $keySetupAst = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'android-release-key-setup.ps1'), [ref]$null, [ref]$null
  )
  $encoder = $keySetupAst.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq 'ConvertTo-JavaPropertyValue'
  }, $true)
  . ([scriptblock]::Create($encoder.Extent.Text))
  $unicodeSigningRoot = Join-Path $testRoot '中文 签名目录'
  New-Item -ItemType Directory -Path $unicodeSigningRoot -Force | Out-Null
  $unicodeKeystore = Join-Path $unicodeSigningRoot '正式 签名.jks'
  New-Item -ItemType File -Path $unicodeKeystore -Force | Out-Null
  $unicodeProperties = Join-Path $unicodeSigningRoot 'key.properties'
  @(
    "storeFile=$(ConvertTo-JavaPropertyValue ($unicodeKeystore -replace '\\', '/'))"
    'storePassword=TEST_STORE_PASSWORD'
    "keyAlias=$(ConvertTo-JavaPropertyValue '正式签名')"
    'keyPassword=TEST_KEY_PASSWORD'
  ) | Set-Content -LiteralPath $unicodeProperties -Encoding ASCII
  $unicodeResult = (& $scriptPath -Release -KeyPropertiesPath $unicodeProperties -Device 'TEST_DEVICE' `
    -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
    -GradleSha256 $gradleSha256 -DryRun | ConvertFrom-Json)
  Assert-Equal 'Unicode signing path preflight' $unicodeResult.Mode 'release-dry-run'

  $buildAst = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
  foreach ($functionName in @('ConvertFrom-JavaPropertyValue', 'Read-SigningPropertyMetadata')) {
    $definition = $buildAst.Find({ param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
    }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
  }
  $encodedForwardPath = ConvertTo-JavaPropertyValue ($unicodeKeystore -replace '\\', '/')
  $splitAt = $encodedForwardPath.LastIndexOf('/')
  $propertiesCases = @(
    @{ Label = 'Backslash path and Unicode alias'; Lines = @(
      "storeFile=$(ConvertTo-JavaPropertyValue $unicodeKeystore)"
      "keyAlias=$(ConvertTo-JavaPropertyValue '签名😀')"
    ); StoreFile = $unicodeKeystore; Alias = '签名😀' }
    @{ Label = 'Colon and whitespace separators'; Lines = @(
      "storeFile : $encodedForwardPath"
      'keyAlias release\ alias\=\:\#\!'
    ); StoreFile = ($unicodeKeystore -replace '\\', '/'); Alias = 'release alias=:#!' }
    @{ Label = 'Continuation and escaped key'; Lines = @(
      ('store\u0046ile=' + $encodedForwardPath.Substring(0, $splitAt) + '\')
      ('  ' + $encodedForwardPath.Substring($splitAt))
      'keyAlias=\ release '
    ); StoreFile = ($unicodeKeystore -replace '\\', '/'); Alias = ' release ' }
  )
  foreach ($case in $propertiesCases) {
    @('# fixture comment', '! fixture comment') + $case.Lines + @(
      'storePassword=TEST_STORE_PASSWORD', 'keyPassword=TEST_KEY_PASSWORD'
    ) | Set-Content -LiteralPath $unicodeProperties -Encoding ASCII
    $metadata = Read-SigningPropertyMetadata $unicodeProperties
    Assert-Equal "$($case.Label) path" $metadata.StoreFile $case.StoreFile
    Assert-Equal "$($case.Label) alias" $metadata.KeyAlias $case.Alias
    $decodedResult = (& $scriptPath -Release -KeyPropertiesPath $unicodeProperties -Device 'TEST_DEVICE' `
      -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
      -GradleSha256 $gradleSha256 -DryRun | ConvertFrom-Json)
    Assert-Equal "$($case.Label) preflight" $decodedResult.Mode 'release-dry-run'
  }
  Assert-Equal 'Java tab/newline/form-feed escapes' (ConvertFrom-JavaPropertyValue '\t\n\r\f') "`t`n`r`f"
  Assert-Equal 'Java unknown escape drops backslash' (ConvertFrom-JavaPropertyValue 'release\q') 'releaseq'
  $malformedRejected = $false
  try { ConvertFrom-JavaPropertyValue '\u12xz' | Out-Null } catch {
    $malformedRejected = $_.Exception.Message -match 'malformed Unicode escape'
  }
  Assert-Equal 'Malformed Unicode escape rejected' ([string]$malformedRejected) 'True'

  # These isolated fixtures exercise metadata and the complete DryRun entry only.
  # Unlocking and signing with an actual JKS remain separate real-JDK checks.
  $r18Properties = Join-Path $testRoot 'r18-key.properties'
  $r18Cases = @(
    @{ Label = 'store password not provided'; Missing = 'storePassword'; ExpectedMissing = 'storePassword' }
    @{ Label = 'store password empty'; Values = @{ storePassword = '' }; ExpectedMissing = 'storePassword' }
    @{ Label = 'key password not provided'; Missing = 'keyPassword'; ExpectedMissing = 'keyPassword' }
    @{ Label = 'key password empty'; Values = @{ keyPassword = '' }; ExpectedMissing = 'keyPassword' }
    @{ Label = 'store file whitespace remains missing'; Values = @{ storeFile = (' ' * 16) }; ExpectedMissing = 'storeFile' }
    @{ Label = 'key alias whitespace remains missing'; Values = @{ keyAlias = (' ' * 16) }; ExpectedMissing = 'keyAlias' }
    @{ Label = 'ordinary passwords'; Values = @{
      storePassword = 'R18OrdinaryStore!2026'; keyPassword = 'R18OrdinaryKey!!2026'
    } }
    @{ Label = 'leading and trailing spaces'; Values = @{
      storePassword = '  R18PaddedStore!2026 '; keyPassword = ' R18PaddedKey!!2026  '
    } }
    @{ Label = 'middle spaces'; Values = @{
      storePassword = 'R18 Middle Store!2026'; keyPassword = 'R18 Middle Key!!2026'
    } }
  )
  foreach ($whitespaceCase in @(
    @{ Label = '16 ASCII spaces'; Value = (' ' * 16) }
    @{ Label = '16 tabs'; Value = ("`t" * 16) }
    @{ Label = 'mixed whitespace'; Value = ((" `t`r`n`f" + [char]0x00a0 + [char]0x3000) * 3) }
    @{ Label = '16 Unicode no-break spaces'; Value = ([string][char]0x00a0 * 16) }
  )) {
    foreach ($passwordFields in @(
      @{ Label = 'store'; Names = @('storePassword') }
      @{ Label = 'key'; Names = @('keyPassword') }
      @{ Label = 'both'; Names = @('storePassword', 'keyPassword') }
    )) {
      $overrides = @{}
      foreach ($name in $passwordFields.Names) { $overrides[$name] = $whitespaceCase.Value }
      $r18Cases += @{ Label = "$($whitespaceCase.Label) $($passwordFields.Label) password"; Values = $overrides }
    }
  }
  $r18Failures = [Collections.Generic.List[string]]::new()
  foreach ($case in $r18Cases) {
    $values = [ordered]@{
      storeFile = ($testKeystore -replace '\\', '/')
      storePassword = 'TEST_R18_STORE_PASSWORD'
      keyAlias = 'baobao-today-release'
      keyPassword = 'TEST_R18_KEY_PASSWORD'
    }
    if ($case.Values) {
      foreach ($name in $case.Values.Keys) { $values[$name] = $case.Values[$name] }
    }
    $lines = foreach ($name in $values.Keys) {
      if ($name -ne $case.Missing) {
        $encoded = ConvertTo-JavaPropertyValue $values[$name]
        if ($name -in @('storePassword', 'keyPassword') -and
            (ConvertFrom-JavaPropertyValue $encoded) -cne $values[$name]) {
          $r18Failures.Add("$($case.Label): $name did not round trip exactly")
        }
        "$name=$encoded"
      }
    }
    $lines | Set-Content -LiteralPath $r18Properties -Encoding ASCII

    $metadata = $null
    $metadataFailure = $null
    try { $metadata = Read-SigningPropertyMetadata $r18Properties } catch {
      $metadataFailure = $_.Exception.Message
    }
    $dryRunRecords = @()
    $dryRunFailure = $null
    try {
      $dryRunRecords = @(& $scriptPath -Release -KeyPropertiesPath $r18Properties -Device 'TEST_DEVICE' `
        -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
        -GradleSha256 $gradleSha256 -DryRun)
    } catch {
      $dryRunFailure = $_.Exception.Message
    }
    $dryRunText = ($dryRunRecords -join "`n")
    foreach ($failureText in @($metadataFailure, $dryRunFailure)) {
      foreach ($name in @('storePassword', 'keyPassword')) {
        $password = [string]$values[$name]
        if (-not [string]::IsNullOrWhiteSpace($password) -and $failureText -and $failureText.Contains($password)) {
          $r18Failures.Add("$($case.Label): error text leaked a password")
        }
      }
    }
    foreach ($name in @('storePassword', 'keyPassword')) {
      $password = [string]$values[$name]
      if (-not [string]::IsNullOrWhiteSpace($password) -and $dryRunText.Contains($password)) {
        $r18Failures.Add("$($case.Label): DryRun output leaked a password")
      }
    }
    if ($case.ExpectedMissing) {
      $expectedMessage = "Android release key.properties is missing $($case.ExpectedMissing)"
      if ($metadataFailure -ne $expectedMessage) {
        $r18Failures.Add("$($case.Label): metadata did not reject the missing field")
      }
      if ($dryRunFailure -ne $expectedMessage) {
        $r18Failures.Add("$($case.Label): DryRun did not reject the missing field")
      }
    } else {
      if ($metadataFailure) {
        $r18Failures.Add("$($case.Label): metadata rejected a provided nonempty password")
      } else {
        if (@($metadata.PSObject.Properties.Name) -contains 'StorePassword' -or
            @($metadata.PSObject.Properties.Name) -contains 'KeyPassword') {
          $r18Failures.Add("$($case.Label): metadata returned password material")
        }
      }
      if ($dryRunFailure) {
        $r18Failures.Add("$($case.Label): DryRun rejected a provided nonempty password")
      } else {
        $accepted = $dryRunText | ConvertFrom-Json
        if ($accepted.Mode -ne 'release-dry-run' -or -not $accepted.KeyPropertiesConfigured) {
          $r18Failures.Add("$($case.Label): Release DryRun did not confirm signing configuration")
        }
        if ($dryRunText -match 'storePassword|keyPassword') {
          $r18Failures.Add("$($case.Label): DryRun output included password fields")
        }
      }
    }
  }
  if ($r18Failures.Count -gt 0) {
    throw ("R18 build password matrix failures:`n" + ($r18Failures -join "`n"))
  }
  Write-Output "R18 build password metadata and Release DryRun matrix: $($r18Cases.Count) cases passed"

  # An escaped alias must still trigger the debug signing guard.
  (Get-Content -LiteralPath $unicodeProperties) -replace '^keyAlias=.*', 'keyAlias=androiddebug\u006bey' `
    | Set-Content -LiteralPath $unicodeProperties -Encoding ASCII
  $escapedDebugAliasRejected = $false
  try {
    & $scriptPath -Release -KeyPropertiesPath $unicodeProperties -Device 'TEST_DEVICE' `
      -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
      -GradleSha256 $gradleSha256 -DryRun | Out-Null
  } catch {
    $escapedDebugAliasRejected = $_.Exception.Message -match 'debug signing material'
  }
  Assert-Equal 'Escaped debug alias rejected' ([string]$escapedDebugAliasRejected) 'True'

  $versionOverrideRejected = $false
  try {
    & $scriptPath -VersionCodeOverride 1 -DryRun | Out-Null
  } catch [System.Management.Automation.ParameterBindingException] {
    $versionOverrideRejected = $true
  }
  Assert-Equal 'Temporary version override rejected' ([string]$versionOverrideRejected) 'True'

  $insideRepositoryRejected = $false
  try {
    & $scriptPath -Release -KeyPropertiesPath (Join-Path $sourceRoot 'app.json') -BuildRoot $explicitBuildRoot `
      -JavaHome $javaHome -AndroidSdkRoot $androidSdkRoot -GradleZip $gradleZip `
      -GradleSha256 $gradleSha256 -DryRun | Out-Null
  } catch {
    $insideRepositoryRejected = $_.Exception.Message -match 'must be stored outside the source repository and build mirror'
  }
  if (-not $insideRepositoryRejected) {
    throw 'Signing properties inside the repository were not rejected'
  }

  $signingScriptPath = Join-Path $PSScriptRoot 'android-release-signing.gradle'
  if (-not (Test-Path -LiteralPath $signingScriptPath -PathType Leaf)) {
    throw 'Safe Android release signing Gradle script is missing'
  }
  $signingScriptContent = Get-Content -Raw -LiteralPath $signingScriptPath -Encoding UTF8
  foreach ($requiredText in @('BAOBAO_ANDROID_KEY_PROPERTIES', 'baobaoRelease', 'androiddebugkey', 'debug.keystore')) {
    if ($signingScriptContent -notmatch [regex]::Escape($requiredText)) {
      throw "Signing Gradle script does not contain required guard: $requiredText"
    }
  }

  $packageJson = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'package.json') -Encoding UTF8 | ConvertFrom-Json
  Assert-Equal 'android:release package script' ([string]$packageJson.scripts.'android:release') `
    'pwsh -NoProfile -File ./scripts/android-local-build.ps1 -Release'

  $unsafeRejected = $false
  try {
    & $scriptPath -BuildRoot $buildRoot -DryRun | Out-Null
  } catch {
    $unsafeRejected = $_.Exception.Message -match 'external mirrors are disabled'
  }
  if (-not $unsafeRejected) {
    throw 'Unsafe build root was not rejected'
  }

  Write-Output 'android-local-build parameter, environment, device, and safety dry-run tests: passed'
} finally {
  foreach ($entry in $originalEnvironment.GetEnumerator()) {
    Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
  }
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    $resolvedTempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notlike 'baobao-android-build-test-*') {
      throw 'Refusing to remove a test directory outside the expected temporary root'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
