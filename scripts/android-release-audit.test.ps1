$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'android-release-audit.ps1'
$testRoot = Join-Path $env:TEMP "baobao-release-audit-test-$([guid]::NewGuid().ToString('N'))"

function Assert-Equal([string]$label, [string]$actual, [string]$expected) {
  if ($actual -ne $expected) {
    throw "$label expected '$expected', received '$actual'"
  }
}

function New-TestArchive([string]$Path, [string]$DexContent) {
  $payloadRoot = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $payloadRoot 'classes.dex') -Value $DexContent -Encoding ASCII
  $zipPath = "$Path.zip"
  Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $zipPath
  Move-Item -LiteralPath $zipPath -Destination $Path
}

function Write-FakeManifestTool([string]$Path, [switch]$WithProhibitedPermission) {
  $permissionLine = if ($WithProhibitedPermission) {
    'echo ^<uses-permission android:name="android.permission.RECORD_AUDIO" /^>'
  } else {
    'echo ^<uses-permission android:name="android.permission.INTERNET" /^>'
  }
  @(
    '@echo off'
    'echo ^<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.baobaotoday.app"^>'
    $permissionLine
    'echo ^<application android:debuggable="false"^>'
    'echo ^<activity android:name=".MainActivity" android:exported="true" /^>'
    'echo ^</application^>'
    'echo ^</manifest^>'
  ) | Set-Content -LiteralPath $Path -Encoding ASCII
}

function Find-TestJavaHome {
  $candidates = @($env:JAVA_HOME)
  if ($env:LOCALAPPDATA) {
    $candidates += @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft\OpenJDK17') `
      -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending `
      | ForEach-Object { $_.FullName })
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'bin\jarsigner.exe'))) {
      return $candidate
    }
  }
  throw 'JDK 17 is required for the release signature behavior tests'
}

function Invoke-TestJdk([string]$Tool, [string[]]$ToolArguments) {
  $output = @(& (Join-Path $javaHome "bin\$Tool.exe") @ToolArguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Fixture $Tool failed: $($output -join ' ')" }
  return @($output | ForEach-Object { [string]$_ })
}

function Assert-AabRejected([string]$Label, [string]$ArchivePath) {
  $rejectedOutput = Join-Path $testRoot "$Label-audit.json"
  $failure = $null
  try {
    & $scriptPath -ApkPath $apkPath -AabPath $ArchivePath -AndroidSdkRoot $sdkRoot `
      -JavaHome $javaHome -OutputPath $rejectedOutput | Out-Null
  } catch { $failure = $_ }
  if (-not $failure -or $failure.Exception.Message -notmatch 'AAB signature') {
    throw "Release audit did not reject $Label through signature verification"
  }
  if (Test-Path -LiteralPath $rejectedOutput) {
    throw "Release audit wrote successful evidence for $Label"
  }
  Write-Output "$Label rejected through real JDK signature verification"
}

function Set-ArchiveEntry([string]$Path, [string]$Name, [string]$Content) {
  $archive = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Update)
  try {
    $existing = $archive.GetEntry($Name)
    if ($existing) { $existing.Delete() }
    $entry = $archive.CreateEntry($Name)
    $writer = [IO.StreamWriter]::new($entry.Open())
    try { $writer.Write($Content) } finally { $writer.Dispose() }
  } finally { $archive.Dispose() }
}

try {
  $sdkRoot = Join-Path $testRoot 'android-sdk'
  $javaHome = Find-TestJavaHome
  $buildTools = Join-Path $sdkRoot 'build-tools\36.0.0'
  $cmdlineBin = Join-Path $sdkRoot 'cmdline-tools\latest\bin'
  New-Item -ItemType Directory -Path $buildTools -Force | Out-Null
  New-Item -ItemType Directory -Path $cmdlineBin -Force | Out-Null
  @'
@echo off
if "%2"=="badging" echo package: name='com.baobaotoday.app' versionCode='2' versionName='1.0.0'
if "%2"=="permissions" echo uses-permission: name='android.permission.INTERNET'
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $buildTools 'aapt2.cmd') -Encoding ASCII
  Write-FakeManifestTool (Join-Path $cmdlineBin 'apkanalyzer.cmd')
  $apkPath = Join-Path $testRoot 'app-release.apk'
  $aabPath = Join-Path $testRoot 'app-release.aab'
  $outputPath = Join-Path $testRoot 'audit.json'
  New-TestArchive $apkPath 'release-code-without-development-markers'
  New-TestArchive $aabPath 'release-bundle'

  $fixtureKeystore = Join-Path $testRoot 'fixture-only.jks'
  Invoke-TestJdk 'keytool' @('-genkeypair', '-noprompt', '-storetype', 'JKS', '-keystore', $fixtureKeystore,
    '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=Isolated Release Audit Fixture', '-storepass', 'fixture-password', '-keypass', 'fixture-password') | Out-Null
  $fixtureCertificate = Join-Path $testRoot 'fixture-only.cer'
  Invoke-TestJdk 'keytool' @('-exportcert', '-keystore', $fixtureKeystore, '-alias', 'fixture',
    '-storepass', 'fixture-password', '-file', $fixtureCertificate) | Out-Null
  $certificateSha256 = (Get-FileHash -LiteralPath $fixtureCertificate -Algorithm SHA256).Hash.ToLowerInvariant()
  @(
    '@echo off'
    'echo Verifies'
    "echo Signer #1 certificate SHA-256 digest: $certificateSha256"
    'exit /b 0'
  ) | Set-Content -LiteralPath (Join-Path $buildTools 'apksigner.cmd') -Encoding ASCII

  Assert-AabRejected 'unsigned' $aabPath
  Invoke-TestJdk 'jarsigner' @('-keystore', $fixtureKeystore, '-storepass', 'fixture-password',
    '-keypass', 'fixture-password', $aabPath, 'fixture') | Out-Null
  $selfSignedVerifier = Invoke-TestJdk 'jarsigner' @('-J-Duser.language=en', '-J-Duser.country=US',
    '-verify', '-certs', $aabPath)
  if (($selfSignedVerifier -join "`n") -notmatch 'self-signed') {
    throw 'Signature fixture did not exercise the self-signed certificate warning'
  }

  $resultJson = & $scriptPath -ApkPath $apkPath -AabPath $aabPath -AndroidSdkRoot $sdkRoot `
    -JavaHome $javaHome -OutputPath $outputPath
  $result = $resultJson | ConvertFrom-Json
  Assert-Equal 'Package name' $result.PackageName 'com.baobaotoday.app'
  Assert-Equal 'Version name' $result.VersionName '1.0.0'
  Assert-Equal 'Version code' ([string]$result.VersionCode) '2'
  Assert-Equal 'Certificate digest' $result.CertificateSha256 $certificateSha256
  Assert-Equal 'APK signature verified' ([string]$result.ApkSignatureVerified) 'True'
  Assert-Equal 'AAB signature verified' ([string]$result.AabSignatureVerified) 'True'
  Write-Output 'Valid signature with self-signed certificate warning accepted'
  Assert-Equal 'Debuggable' ([string]$result.Debuggable) 'False'
  Assert-Equal 'Prohibited permission count' ([string]$result.ProhibitedPermissions.Count) '0'
  Assert-Equal 'Exported component count' ([string]$result.ExportedComponents.Count) '1'
  Assert-Equal 'Development marker count' ([string]$result.DevelopmentMarkers.Count) '0'
  if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
    throw 'Release audit did not write its evidence JSON'
  }

  $tamperedAab = Join-Path $testRoot 'tampered.aab'
  Copy-Item -LiteralPath $aabPath -Destination $tamperedAab
  Set-ArchiveEntry $tamperedAab 'classes.dex' 'tampered-code'
  Assert-AabRejected 'tampered' $tamperedAab

  $uncoveredAab = Join-Path $testRoot 'uncovered.aab'
  Copy-Item -LiteralPath $aabPath -Destination $uncoveredAab
  Set-ArchiveEntry $uncoveredAab 'base/extra.dex' 'unsigned-code'
  Assert-AabRejected 'uncovered-entry' $uncoveredAab

  $uncoveredMetadata = Join-Path $testRoot 'uncovered-metadata.aab'
  Copy-Item -LiteralPath $aabPath -Destination $uncoveredMetadata
  Set-ArchiveEntry $uncoveredMetadata 'META-INF/application.properties' 'unsigned-metadata'
  Assert-AabRejected 'uncovered-metadata' $uncoveredMetadata

  $mismatchedSigner = Join-Path $testRoot 'mismatched.aab'
  New-TestArchive $mismatchedSigner 'other-signer-code'
  Invoke-TestJdk 'keytool' @('-genkeypair', '-noprompt', '-storetype', 'JKS', '-keystore', $fixtureKeystore,
    '-alias', 'other', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=Other Isolated Fixture', '-storepass', 'fixture-password', '-keypass', 'fixture-password') | Out-Null
  Invoke-TestJdk 'jarsigner' @('-keystore', $fixtureKeystore, '-storepass', 'fixture-password',
    '-keypass', 'fixture-password', $mismatchedSigner, 'other') | Out-Null
  Assert-AabRejected 'certificate-mismatch' $mismatchedSigner

  $devApkPath = Join-Path $testRoot 'app-release-with-dev-marker.apk'
  $devOutputPath = Join-Path $testRoot 'audit-dev.json'
  New-TestArchive $devApkPath 'EXDevLauncher localhost:8081'
  $developmentMarkerRejected = $false
  try {
    & $scriptPath -ApkPath $devApkPath -AabPath $aabPath -AndroidSdkRoot $sdkRoot `
      -JavaHome $javaHome -OutputPath $devOutputPath | Out-Null
  } catch {
    $developmentMarkerRejected = $_.Exception.Message -match 'development markers'
  }
  if (-not $developmentMarkerRejected) {
    throw 'Release audit did not reject packaged development markers'
  }

  $disabledStubApkPath = Join-Path $testRoot 'app-release-with-disabled-expo-stubs.apk'
  $disabledStubOutputPath = Join-Path $testRoot 'audit-disabled-stubs.json'
  New-TestArchive $disabledStubApkPath 'expo.modules.devlauncher expo/modules/devmenu'
  $disabledStubResult = (& $scriptPath -ApkPath $disabledStubApkPath -AabPath $aabPath `
    -AndroidSdkRoot $sdkRoot -JavaHome $javaHome -OutputPath $disabledStubOutputPath | ConvertFrom-Json)
  Assert-Equal 'Disabled release stub marker count' ([string]$disabledStubResult.DevelopmentMarkers.Count) '0'

  Write-FakeManifestTool (Join-Path $cmdlineBin 'apkanalyzer.cmd') -WithProhibitedPermission
  $permissionRejected = $false
  try {
    & $scriptPath -ApkPath $apkPath -AabPath $aabPath -AndroidSdkRoot $sdkRoot `
      -JavaHome $javaHome -OutputPath (Join-Path $testRoot 'audit-prohibited.json') | Out-Null
  } catch {
    $permissionRejected = $_.Exception.Message -match 'prohibited Android permissions'
  }
  if (-not $permissionRejected) {
    throw 'Release audit did not reject a prohibited permission'
  }

  Write-Output 'android release artifact signature, manifest, permission, and package-content audit tests: passed'
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    $resolvedTempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notlike 'baobao-release-audit-test-*') {
      throw 'Refusing to remove a test directory outside the expected temporary root'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
