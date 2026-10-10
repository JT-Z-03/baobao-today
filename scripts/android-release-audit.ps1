[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApkPath,
  [Parameter(Mandatory = $true)][string]$AabPath,
  [string]$AndroidSdkRoot,
  [string]$JavaHome,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

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

function Find-Tool([string[]]$Candidates, [string]$Label) {
  foreach ($candidate in $Candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }
  throw "$Label was not found"
}

function Find-BuildTool([string]$SdkRoot, [string]$BaseName) {
  $buildToolsRoot = Join-Path $SdkRoot 'build-tools'
  $versions = Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue `
    | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending
  foreach ($version in $versions) {
    foreach ($extension in @('.exe', '.bat', '.cmd')) {
      $candidate = Join-Path $version.FullName "$BaseName$extension"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
      }
    }
  }
  throw "$BaseName was not found under Android SDK build-tools"
}

function Invoke-ExternalRead([string]$ToolPath, [string[]]$Arguments, [string]$Label) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $ToolPath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }
  return @($output | ForEach-Object { [string]$_ })
}

function Find-DevelopmentMarkers([string]$ArchivePath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $markers = @(
    'DevLauncherActivity',
    'DevLauncherErrorActivity',
    'expo.modules.devlauncher.compose.AuthActivity',
    'DevMenuManager',
    'localhost:8081',
    '10.0.2.2:8081'
  )
  $found = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -notmatch '(^|/)classes\d*\.dex$') {
        continue
      }
      $stream = $entry.Open()
      $memory = New-Object IO.MemoryStream
      try {
        $stream.CopyTo($memory)
        $ascii = [Text.Encoding]::ASCII.GetString($memory.ToArray())
        foreach ($marker in $markers) {
          if ($ascii.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            [void]$found.Add($marker)
          }
        }
      } finally {
        $memory.Dispose()
        $stream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
  return @($found | Sort-Object)
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedApkPath = Resolve-NormalizedPath $ApkPath 'Release APK path'
$resolvedAabPath = Resolve-NormalizedPath $AabPath 'Release AAB path'
$resolvedOutputPath = Resolve-NormalizedPath $OutputPath 'Release audit output path'
foreach ($artifactPath in @($resolvedApkPath, $resolvedAabPath)) {
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Release artifact does not exist: $artifactPath"
  }
}
if (Test-PathWithin $resolvedOutputPath $sourceRoot) {
  throw 'Release audit evidence must be stored outside the source repository'
}

$sdkInput = if (-not [string]::IsNullOrWhiteSpace($AndroidSdkRoot)) {
  $AndroidSdkRoot
} elseif (-not [string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) {
  $env:ANDROID_HOME
} else {
  $env:ANDROID_SDK_ROOT
}
$resolvedSdkRoot = Resolve-NormalizedPath $sdkInput 'Android SDK root'
$javaInput = if (-not [string]::IsNullOrWhiteSpace($JavaHome)) { $JavaHome } else { $env:JAVA_HOME }
$resolvedJavaHome = Resolve-NormalizedPath $javaInput 'JAVA_HOME'

$apkSigner = Find-BuildTool $resolvedSdkRoot 'apksigner'
$aapt2 = Find-BuildTool $resolvedSdkRoot 'aapt2'
$apkAnalyzer = Find-Tool @(
  (Join-Path $resolvedSdkRoot 'cmdline-tools\latest\bin\apkanalyzer.bat'),
  (Join-Path $resolvedSdkRoot 'cmdline-tools\latest\bin\apkanalyzer.cmd')
) 'apkanalyzer'
$jarSigner = Find-Tool @(
  (Join-Path $resolvedJavaHome 'bin\jarsigner.exe'),
  (Join-Path $resolvedJavaHome 'bin\jarsigner.bat'),
  (Join-Path $resolvedJavaHome 'bin\jarsigner.cmd')
) 'JDK jarsigner'
$java = Find-Tool @((Join-Path $resolvedJavaHome 'bin\java.exe')) 'JDK Java'

$apkSignerOutput = Invoke-ExternalRead $apkSigner @('verify', '--verbose', '--print-certs', $resolvedApkPath) 'APK signature verification'
$certificateMatches = [regex]::Matches(
  ($apkSignerOutput -join "`n"),
  'certificate SHA-256 digest:\s*([0-9a-f:]+)',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase
)
if ($certificateMatches.Count -ne 1) {
  throw 'APK signature verification must report exactly one signing certificate SHA-256 digest'
}
$certificateSha256 = $certificateMatches[0].Groups[1].Value.Replace(':', '').ToLowerInvariant()
if ($certificateSha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'APK signature verification reported an invalid certificate SHA-256 digest'
}

$jarSignerOutput = Invoke-ExternalRead $jarSigner @('-verify', '-certs', $resolvedAabPath) 'AAB signature verification'
$aabVerifierOutput = Invoke-ExternalRead $java @(
  '--source', '17', (Join-Path $PSScriptRoot 'AabSignatureVerifier.java'), $resolvedAabPath, $certificateSha256
) 'AAB signature coverage and certificate verification'
if ($aabVerifierOutput -cnotcontains "AAB_SIGNATURE_VERIFIED:$certificateSha256") {
  throw 'AAB signature verifier did not confirm signed content and matching APK certificate'
}
$badgingOutput = Invoke-ExternalRead $aapt2 @('dump', 'badging', $resolvedApkPath) 'APK badging audit'
$permissionsOutput = Invoke-ExternalRead $aapt2 @('dump', 'permissions', $resolvedApkPath) 'APK permission audit'
$manifestOutput = Invoke-ExternalRead $apkAnalyzer @('manifest', 'print', $resolvedApkPath) 'APK manifest audit'

$badgingMatch = [regex]::Match(
  ($badgingOutput -join "`n"),
  "package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']*)'"
)
if (-not $badgingMatch.Success) {
  throw 'APK badging did not report package name, versionCode, and versionName'
}

try {
  [xml]$manifest = $manifestOutput -join "`n"
} catch {
  throw 'APK analyzer returned invalid manifest XML'
}
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$namespaceManager = New-Object Xml.XmlNamespaceManager($manifest.NameTable)
$namespaceManager.AddNamespace('android', $androidNamespace)
$applicationNode = $manifest.SelectSingleNode('/manifest/application')
if (-not $applicationNode) {
  throw 'Release manifest does not contain an application element'
}
$debuggable = $applicationNode.GetAttribute('debuggable', $androidNamespace) -eq 'true'
if ($debuggable) {
  throw 'Release manifest is debuggable'
}

$permissionNodes = @($manifest.SelectNodes('/manifest/uses-permission'))
$permissions = @($permissionNodes | ForEach-Object { $_.GetAttribute('name', $androidNamespace) } | Where-Object { $_ } | Sort-Object -Unique)
$prohibitedPermissionNames = @(
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.CALL_PHONE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.SEND_SMS',
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.FOREGROUND_SERVICE'
)
$prohibitedPermissions = @($permissions | Where-Object { $prohibitedPermissionNames -contains $_ })
if ($prohibitedPermissions.Count -gt 0) {
  throw "Release manifest contains prohibited Android permissions: $($prohibitedPermissions -join ', ')"
}

$componentNodes = @($manifest.SelectNodes('/manifest/application/activity | /manifest/application/activity-alias | /manifest/application/service | /manifest/application/receiver | /manifest/application/provider'))
$exportedComponents = @()
$missingExported = @()
foreach ($node in $componentNodes) {
  $name = $node.GetAttribute('name', $androidNamespace)
  $hasExported = $node.HasAttribute('exported', $androidNamespace)
  $exported = $node.GetAttribute('exported', $androidNamespace)
  if ($exported -eq 'true') {
    $exportedComponents += [pscustomobject]@{ Type = $node.LocalName; Name = $name; Exported = $true }
  }
  if ($node.SelectSingleNode('intent-filter') -and -not $hasExported) {
    $missingExported += $name
  }
}
if ($missingExported.Count -gt 0) {
  throw "Release manifest components with intent filters are missing exported state: $($missingExported -join ', ')"
}

$developmentMarkers = @(Find-DevelopmentMarkers $resolvedApkPath)
if ($developmentMarkers.Count -gt 0) {
  throw "Release package contains development markers: $($developmentMarkers -join ', ')"
}
$outputDirectory = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$result = [ordered]@{
  PackageName = $badgingMatch.Groups[1].Value
  VersionCode = [int]$badgingMatch.Groups[2].Value
  VersionName = $badgingMatch.Groups[3].Value
  CertificateSha256 = $certificateSha256
  ApkSignatureVerified = $true
  AabSignatureVerified = $true
  ApkSha256 = (Get-FileHash -LiteralPath $resolvedApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
  ApkBytes = (Get-Item -LiteralPath $resolvedApkPath).Length
  AabSha256 = (Get-FileHash -LiteralPath $resolvedAabPath -Algorithm SHA256).Hash.ToLowerInvariant()
  AabBytes = (Get-Item -LiteralPath $resolvedAabPath).Length
  Debuggable = $debuggable
  Permissions = @($permissions)
  ProhibitedPermissions = @($prohibitedPermissions)
  ExportedComponents = @($exportedComponents)
  DevelopmentMarkers = @($developmentMarkers)
  Aapt2PermissionSummary = @($permissionsOutput)
  AabVerifierSummary = @($jarSignerOutput | Select-Object -Last 20)
}
$json = $result | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($resolvedOutputPath, $json, (New-Object Text.UTF8Encoding($false)))
$result | ConvertTo-Json -Depth 8 -Compress
