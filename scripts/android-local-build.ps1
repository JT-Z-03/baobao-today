[CmdletBinding()]
param(
  [string]$Device,
  [string]$BuildRoot,
  [string]$JavaHome,
  [string]$AndroidSdkRoot,
  [string]$GradleZip,
  [string]$GradleSha256,
  [switch]$Release,
  [switch]$Install,
  [string]$KeyPropertiesPath,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$defaultGradleSha256 = 'b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06'

function Select-FirstValue([string[]]$Values) {
  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }
  return $null
}

function Resolve-NormalizedPath([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Label is not configured"
  }
  $providerPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Value)
  return [IO.Path]::GetFullPath($providerPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Test-PathWithin([string]$Candidate, [string]$Root) {
  $comparison = [StringComparison]::OrdinalIgnoreCase
  $normalizedRoot = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar)
  return $Candidate.Equals($normalizedRoot, $comparison) `
    -or $Candidate.StartsWith($normalizedRoot + [IO.Path]::DirectorySeparatorChar, $comparison)
}

function ConvertFrom-JavaPropertyValue([string]$Value) {
  $builder = [Text.StringBuilder]::new()
  for ($index = 0; $index -lt $Value.Length; $index += 1) {
    $character = $Value[$index]
    if ($character -ne '\') {
      [void]$builder.Append($character)
      continue
    }
    $index += 1
    if ($index -ge $Value.Length) { break }
    switch -CaseSensitive ($Value[$index]) {
      'u' {
        if ($index + 4 -ge $Value.Length -or $Value.Substring($index + 1, 4) -cnotmatch '^[0-9a-fA-F]{4}$') {
          throw 'Android release key.properties contains a malformed Unicode escape'
        }
        [void]$builder.Append([char][Convert]::ToInt32($Value.Substring($index + 1, 4), 16))
        $index += 4
      }
      't' { [void]$builder.Append("`t") }
      'n' { [void]$builder.Append("`n") }
      'r' { [void]$builder.Append("`r") }
      'f' { [void]$builder.Append("`f") }
      default { [void]$builder.Append($Value[$index]) }
    }
  }
  return $builder.ToString()
}

function Read-SigningPropertyMetadata([string]$PropertiesPath) {
  # Match Properties.load(InputStream) used by android-release-signing.gradle.
  $whitespace = [char[]]" `t`f"
  $logicalLines = [Collections.Generic.List[string]]::new()
  $logical = ''
  $continued = $false
  foreach ($line in [IO.File]::ReadAllLines($PropertiesPath, [Text.Encoding]::Latin1)) {
    $part = $line.TrimStart($whitespace)
    if (-not $continued -and (-not $part -or $part.StartsWith('#') -or $part.StartsWith('!'))) { continue }
    $logical += $part
    $backslashes = 0
    for ($index = $logical.Length - 1; $index -ge 0 -and $logical[$index] -eq '\'; $index -= 1) {
      $backslashes += 1
    }
    $continued = ($backslashes % 2) -eq 1
    if ($continued) {
      $logical = $logical.Substring(0, $logical.Length - 1)
    } else {
      $logicalLines.Add($logical)
      $logical = ''
    }
  }
  if ($continued) { $logicalLines.Add($logical) }
  $properties = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
  foreach ($line in $logicalLines) {
    $separator = $line.Length
    for ($index = 0; $index -lt $line.Length; $index += 1) {
      if ($line[$index] -eq '\') { $index += 1; continue }
      if ($line[$index] -in @('=', ':') -or $line[$index] -in $whitespace) {
        $separator = $index
        break
      }
    }
    $valueStart = $separator
    if ($valueStart -lt $line.Length -and $line[$valueStart] -in @('=', ':')) { $valueStart += 1 }
    while ($valueStart -lt $line.Length -and $line[$valueStart] -in $whitespace) { $valueStart += 1 }
    if ($separator -lt $line.Length -and $line[$separator] -in $whitespace -and
        $valueStart -lt $line.Length -and $line[$valueStart] -in @('=', ':')) {
      $valueStart += 1
      while ($valueStart -lt $line.Length -and $line[$valueStart] -in $whitespace) { $valueStart += 1 }
    }
    $name = ConvertFrom-JavaPropertyValue $line.Substring(0, $separator)
    $properties[$name] = ConvertFrom-JavaPropertyValue $line.Substring($valueStart)
  }
  foreach ($requiredName in @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')) {
    $value = [string]$properties[$requiredName]
    $isPassword = $requiredName -in @('storePassword', 'keyPassword')
    if (($isPassword -and [string]::IsNullOrEmpty($value)) -or
        (-not $isPassword -and [string]::IsNullOrWhiteSpace($value))) {
      throw "Android release key.properties is missing $requiredName"
    }
  }
  return [pscustomobject]@{
    StoreFile = [string]$properties.storeFile
    KeyAlias = [string]$properties.keyAlias
  }
}

function Find-JavaHome {
  $configured = Select-FirstValue @($JavaHome, $env:JAVA_HOME)
  if ($configured) {
    return $configured
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft\OpenJDK17'
    $candidate = Get-ChildItem -LiteralPath $installRoot -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue `
      | Sort-Object Name -Descending `
      | Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }
  throw 'JAVA_HOME is not configured and Microsoft OpenJDK 17 could not be detected under LOCALAPPDATA'
}

function Resolve-AdbPath([string]$SdkRoot) {
  foreach ($name in @('adb.exe', 'adb.cmd', 'adb.bat')) {
    $sdkAdb = Join-Path $SdkRoot "platform-tools\$name"
    if (Test-Path -LiteralPath $sdkAdb -PathType Leaf) {
      return $sdkAdb
    }
  }
  $command = Get-Command adb.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command adb -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }
  throw 'ADB was not found under the Android SDK or PATH'
}

function Invoke-AdbRead([string]$AdbPath, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $AdbPath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Resolve-Device([string]$AdbPath) {
  if (-not [string]::IsNullOrWhiteSpace($Device)) {
    return $Device
  }
  $result = Invoke-AdbRead $AdbPath @('devices')
  if ($result.ExitCode -ne 0) {
    throw "ADB device discovery failed with exit code $($result.ExitCode)"
  }
  $authorized = @($result.Output | ForEach-Object {
    if ([string]$_ -match '^(\S+)\s+device$') { $matches[1] }
  })
  if ($authorized.Count -gt 1) {
    throw 'Multiple authorized Android devices are connected; pass -Device explicitly'
  }
  if ($authorized.Count -eq 1) {
    return $authorized[0]
  }
  return $null
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pathComparison = [StringComparison]::OrdinalIgnoreCase
$resolvedBuildRoot = $sourceRoot
if ($BuildRoot -and -not (Resolve-NormalizedPath $BuildRoot 'BuildRoot').Equals($sourceRoot, $pathComparison)) {
  throw 'BuildRoot must be the current project; external mirrors are disabled'
}

$appConfigPath = Join-Path $sourceRoot 'app.json'
$appConfig = Get-Content -Raw -LiteralPath $appConfigPath -Encoding UTF8 | ConvertFrom-Json
$appVersion = [string]$appConfig.expo.version
$packageConfig = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'package.json') -Encoding UTF8 | ConvertFrom-Json
$packageLock = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'package-lock.json') -Encoding UTF8 | ConvertFrom-Json -AsHashtable
if ($appVersion -ne $packageConfig.version -or $appVersion -ne $packageLock.version -or $appVersion -ne $packageLock.packages[''].version) {
  throw 'App, package and lockfile versions must match before building'
}
$configuredVersionCode = [int]$appConfig.expo.android.versionCode
$effectiveVersionCode = $configuredVersionCode
$resolvedKeyPropertiesPath = $null
$resolvedStoreFile = $null
if ($Release) {
  if ([string]::IsNullOrWhiteSpace($KeyPropertiesPath)) {
    throw 'key.properties is required for release builds'
  }
  $resolvedKeyPropertiesPath = Resolve-NormalizedPath $KeyPropertiesPath 'Android release key.properties path'
  if (-not (Test-Path -LiteralPath $resolvedKeyPropertiesPath -PathType Leaf)) {
    throw 'Android release key.properties file does not exist'
  }
  if ((Test-PathWithin $resolvedKeyPropertiesPath $sourceRoot) -or (Test-PathWithin $resolvedKeyPropertiesPath $resolvedBuildRoot)) {
    throw 'Android release key.properties must be stored outside the source repository and build mirror'
  }
  $signingMetadata = Read-SigningPropertyMetadata $resolvedKeyPropertiesPath
  if ([IO.Path]::IsPathRooted($signingMetadata.StoreFile)) {
    $storeFileInput = $signingMetadata.StoreFile
  } else {
    $storeFileInput = Join-Path (Split-Path -Parent $resolvedKeyPropertiesPath) $signingMetadata.StoreFile
  }
  $resolvedStoreFile = Resolve-NormalizedPath $storeFileInput 'Android release keystore path'
  if (-not (Test-Path -LiteralPath $resolvedStoreFile -PathType Leaf)) {
    throw 'Android release keystore file does not exist'
  }
  if ((Test-PathWithin $resolvedStoreFile $sourceRoot) -or (Test-PathWithin $resolvedStoreFile $resolvedBuildRoot)) {
    throw 'Android release keystore must be stored outside the source repository and build mirror'
  }
  if ((Split-Path -Leaf $resolvedStoreFile) -ieq 'debug.keystore' -or $signingMetadata.KeyAlias -ieq 'androiddebugkey') {
    throw 'Android debug signing material cannot be used for release builds'
  }
} elseif (-not [string]::IsNullOrWhiteSpace($KeyPropertiesPath)) {
  throw 'KeyPropertiesPath is only supported for release builds'
}

$resolvedJavaHome = Resolve-NormalizedPath (Find-JavaHome) 'JAVA_HOME'
$androidSdkInput = Select-FirstValue @($AndroidSdkRoot, $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
$resolvedAndroidSdkRoot = Resolve-NormalizedPath $androidSdkInput 'Android SDK root'
$gradleZipInput = Select-FirstValue @(
  $GradleZip,
  $env:BAOBAO_GRADLE_ZIP,
  $(if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.gradle\manual-distributions\gradle-9.3.1-bin.zip'
  })
)
$resolvedGradleZip = Resolve-NormalizedPath $gradleZipInput 'Gradle archive path'
$resolvedGradleSha256 = (Select-FirstValue @($GradleSha256, $env:BAOBAO_GRADLE_SHA256, $defaultGradleSha256)).ToLowerInvariant()
$javaExecutable = Join-Path $resolvedJavaHome 'bin\java.exe'

foreach ($requiredPath in @($resolvedJavaHome, $resolvedAndroidSdkRoot, $resolvedGradleZip, $javaExecutable)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required local build dependency is missing: $requiredPath"
  }
}

$adb = Resolve-AdbPath $resolvedAndroidSdkRoot
$actualGradleSha256 = (Get-FileHash -LiteralPath $resolvedGradleZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualGradleSha256 -ne $resolvedGradleSha256) {
  throw "Gradle archive checksum mismatch: $actualGradleSha256"
}

$deviceSerial = Resolve-Device $adb
if ($DryRun) {
  [ordered]@{
    Mode = $(if ($Release) { 'release-dry-run' } else { 'dry-run' })
    SourceRoot = $sourceRoot
    BuildRoot = $resolvedBuildRoot
    JavaHome = $resolvedJavaHome
    AndroidSdkRoot = $resolvedAndroidSdkRoot
    AdbPath = $adb
    GradleZip = $resolvedGradleZip
    GradleSha256 = $resolvedGradleSha256
    Device = $deviceSerial
    KeyPropertiesConfigured = [bool]$resolvedKeyPropertiesPath
    VersionName = $appVersion
    VersionCode = $effectiveVersionCode
    GradleTasks = $(if ($Release) { @(':app:assembleRelease', ':app:bundleRelease') } else { @() })
  } | ConvertTo-Json -Compress
  return
}

# SUBST gives native tools an ASCII path to the same files; no copy or directory is created.
$aliasDrive = $null
if ($sourceRoot -match '[^\x00-\x7F]') {
  foreach ($letter in 'R','S','T','U','V','W','X','Y','Z') {
    $candidate = "${letter}:"
    if (-not (Test-Path ($candidate + '\'))) { $aliasDrive = $candidate; break }
  }
  if (-not $aliasDrive) { throw 'No unused drive letter is available for the current project path alias' }
  & subst.exe $aliasDrive $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create temporary project drive alias' }
  $resolvedBuildRoot = $aliasDrive + '\'
}

$env:JAVA_HOME = $resolvedJavaHome
$env:ANDROID_HOME = $resolvedAndroidSdkRoot
$env:ANDROID_SDK_ROOT = $resolvedAndroidSdkRoot
$env:PATH = "$resolvedJavaHome\bin;$resolvedAndroidSdkRoot\platform-tools;$env:PATH"

$expoDevice = $deviceSerial
if ($deviceSerial) {
  $modelResult = Invoke-AdbRead $adb @('-s', $deviceSerial, 'shell', 'getprop', 'ro.product.model')
  if ($modelResult.ExitCode -eq 0) {
    $detectedModel = ($modelResult.Output -join '').Trim()
    if ($detectedModel) {
      $expoDevice = $detectedModel
    }
  }
}

Push-Location $resolvedBuildRoot
$previousSigningProperties = $env:BAOBAO_ANDROID_KEY_PROPERTIES
$previousNodeEnv = $env:NODE_ENV
$previousNativeSource = $env:BBT_NATIVE_SOURCE_ROOT
$previousNativeAlias = $env:BBT_NATIVE_ALIAS_ROOT
try {
  if ($aliasDrive) {
    $env:BBT_NATIVE_SOURCE_ROOT = $sourceRoot
    $env:BBT_NATIVE_ALIAS_ROOT = $resolvedBuildRoot
    $generatedConfig = Join-Path $sourceRoot 'android\build\generated\autolinking\autolinking.json'
    if (Test-Path -LiteralPath $generatedConfig -PathType Leaf) { Remove-Item -LiteralPath $generatedConfig -Force }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedBuildRoot "node_modules"))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
  }
  node (Join-Path $resolvedBuildRoot 'scripts\patch-expo-drive-root.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Expo drive-root compatibility check failed' }
  npx expo prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { throw "Expo prebuild failed with exit code $LASTEXITCODE" }

  # Node emits UTF-8 paths; JDK 17 on Chinese Windows otherwise decodes them as GBK.
  $gradlePropertiesPath = Join-Path $resolvedBuildRoot 'android\gradle.properties'
  $gradleProperties = Get-Content -Raw -LiteralPath $gradlePropertiesPath -Encoding UTF8
  if ($gradleProperties -notmatch '-Dfile.encoding=UTF-8') {
    $gradleProperties = $gradleProperties -replace '(?m)^(org.gradle.jvmargs=.*)$', '$1 -Dfile.encoding=UTF-8'
    [IO.File]::WriteAllText($gradlePropertiesPath, $gradleProperties, [Text.UTF8Encoding]::new($false))
    $generatedAutolinking = Join-Path $resolvedBuildRoot 'android\build\generated\autolinking\autolinking.json'
    if (Test-Path -LiteralPath $generatedAutolinking) { Remove-Item -LiteralPath $generatedAutolinking -Force }
  }

  $wrapperProperties = Join-Path $resolvedBuildRoot 'android\gradle\wrapper\gradle-wrapper.properties'
  $gradleFileUrl = 'file:///' + ($resolvedGradleZip -replace '\\', '/')
  $wrapperContent = Get-Content -Raw -LiteralPath $wrapperProperties
  $wrapperContent = $wrapperContent -replace 'distributionUrl=.*', "distributionUrl=$gradleFileUrl"
  Set-Content -LiteralPath $wrapperProperties -Value $wrapperContent -Encoding ASCII

  if ($Release) {
    $generatedBuildGradle = Join-Path $resolvedBuildRoot 'android\app\build.gradle'
    $buildGradleContent = Get-Content -Raw -LiteralPath $generatedBuildGradle -Encoding UTF8
    $nativeCode = [regex]::Match($buildGradleContent, '(?m)^\s*versionCode\s+(\d+)\s*$').Groups[1].Value
    $nativeVersion = [regex]::Match($buildGradleContent, '(?m)^\s*versionName\s+"([^"]+)"\s*$').Groups[1].Value
    if ($nativeCode -ne [string]$configuredVersionCode -or $nativeVersion -ne $appVersion) {
      throw 'Generated Android version must match app.json; temporary version overrides are not allowed'
    }
    $signingApplyLine = "apply from: file('../../scripts/android-release-signing.gradle')"
    if ($buildGradleContent -notmatch [regex]::Escape($signingApplyLine)) {
      $buildGradleContent = $buildGradleContent.TrimEnd() + "`r`n`r`n$signingApplyLine`r`n"
    }
    [IO.File]::WriteAllText($generatedBuildGradle, $buildGradleContent, (New-Object Text.UTF8Encoding($false)))

    $env:BAOBAO_ANDROID_KEY_PROPERTIES = $resolvedKeyPropertiesPath
    $env:NODE_ENV = 'production'
    $androidProjectRoot = Join-Path $resolvedBuildRoot 'android'
    $gradleWrapper = Join-Path $androidProjectRoot 'gradlew.bat'
    & $gradleWrapper '--project-dir' $androidProjectRoot ':app:assembleRelease' ':app:bundleRelease' '--no-daemon'
    if ($LASTEXITCODE -ne 0) { throw "Expo Android release build failed with exit code $LASTEXITCODE" }

    $apkPath = Join-Path $resolvedBuildRoot 'android\app\build\outputs\apk\release\app-release.apk'
    $aabPath = Join-Path $resolvedBuildRoot 'android\app\build\outputs\bundle\release\app-release.aab'
    foreach ($artifactPath in @($apkPath, $aabPath)) {
      if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        throw "Expected Android release artifact is missing: $artifactPath"
      }
    }
    [ordered]@{
      Mode = 'release'
      VersionName = $appVersion
      VersionCode = $effectiveVersionCode
      ApkPath = $apkPath
      ApkSha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
      ApkBytes = (Get-Item -LiteralPath $apkPath).Length
      AabPath = $aabPath
      AabSha256 = (Get-FileHash -LiteralPath $aabPath -Algorithm SHA256).Hash.ToLowerInvariant()
      AabBytes = (Get-Item -LiteralPath $aabPath).Length
    } | ConvertTo-Json -Compress
  } else {
    $androidProjectRoot = Join-Path $resolvedBuildRoot 'android'
    & (Join-Path $androidProjectRoot 'gradlew.bat') '--project-dir' $androidProjectRoot ':app:assembleDebug' '--no-daemon'
    if ($LASTEXITCODE -ne 0) { throw "Android debug build failed with exit code $LASTEXITCODE" }
    if ($Install) {
      if (-not $deviceSerial) { throw 'Install requested but no authorized Android device is connected' }
      & $adb '-s' $deviceSerial 'install' '-r' (Join-Path $androidProjectRoot 'app\build\outputs\apk\debug\app-debug.apk')
      if ($LASTEXITCODE -ne 0) { throw "Android install failed with exit code $LASTEXITCODE" }
    }
  }
} finally {
  $env:BAOBAO_ANDROID_KEY_PROPERTIES = $previousSigningProperties
  $env:NODE_ENV = $previousNodeEnv
  $env:BBT_NATIVE_SOURCE_ROOT = $previousNativeSource
  $env:BBT_NATIVE_ALIAS_ROOT = $previousNativeAlias
  Pop-Location
  if ($aliasDrive) { & subst.exe $aliasDrive /D }
}
