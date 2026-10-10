[CmdletBinding()]
param(
  [string]$SigningRoot = $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.baobao-today\android-release' }),
  [string]$JavaHome,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$keyAlias = 'baobao-today-release'
$keyAlgorithm = 'RSA'
$keySize = 4096
$validityDays = 10000

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

function Find-JavaHome {
  if (-not [string]::IsNullOrWhiteSpace($JavaHome)) {
    return $JavaHome
  }
  if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    return $env:JAVA_HOME
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
  throw 'Microsoft OpenJDK 17 was not configured or detected'
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-ConfirmedPassword([string]$Label) {
  $firstSecure = Read-Host -AsSecureString -Prompt "$Label (minimum 16 characters)"
  $secondSecure = Read-Host -AsSecureString -Prompt "Confirm $Label"
  $requiredMessage = "$Label must be provided and must not be empty or whitespace-only"
  if ($null -eq $firstSecure -or $null -eq $secondSecure) {
    throw $requiredMessage
  }
  $first = ConvertTo-PlainText $firstSecure
  $second = ConvertTo-PlainText $secondSecure
  if ([string]::IsNullOrWhiteSpace($first)) {
    throw $requiredMessage
  }
  if ($first.Length -lt 16) {
    throw "$Label must contain at least 16 characters"
  }
  if ($first -cne $second) {
    throw "$Label confirmation did not match"
  }
  return $first
}

function ConvertTo-JavaPropertyValue([string]$Value) {
  $builder = New-Object Text.StringBuilder
  for ($index = 0; $index -lt $Value.Length; $index += 1) {
    $character = $Value[$index]
    $codePoint = [int][char]$character
    if ($character -eq '\') {
      [void]$builder.Append('\\')
    } elseif ($character -eq ' ' -and $index -eq 0) {
      [void]$builder.Append('\ ')
    } elseif ($character -eq "`t") {
      [void]$builder.Append('\t')
    } elseif ($character -eq "`r") {
      [void]$builder.Append('\r')
    } elseif ($character -eq "`n") {
      [void]$builder.Append('\n')
    } elseif ($codePoint -lt 32 -or $codePoint -gt 126) {
      [void]$builder.Append(('\u{0:x4}' -f $codePoint))
    } else {
      [void]$builder.Append($character)
    }
  }
  return $builder.ToString()
}

function Set-PrivateDirectoryAcl([string]$Path) {
  $directorySecurity = New-Object Security.AccessControl.DirectorySecurity
  $directorySecurity.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit `
    -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [Security.AccessControl.PropagationFlags]::None
  foreach ($sid in @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-18'))
  )) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      $propagation,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$directorySecurity.AddAccessRule($rule)
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $directorySecurity)
}

function Get-SigningRootChildren([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Android release signing root is not a directory: $Path"
  }
  return @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)
}

function Assert-SigningRootCanInitialize([string]$Path) {
  $children = @(Get-SigningRootChildren $Path)
  $keystores = @($children | Where-Object {
    -not $_.PSIsContainer -and $_.Extension -in @('.jks', '.keystore')
  })
  if ($keystores.Count -gt 0) {
    throw 'Refusing to overwrite or remove an existing Android release keystore'
  }
  if (@($children | Where-Object { $_.Name -eq 'key.properties' }).Count -gt 0) {
    throw 'Refusing to overwrite the existing Android release key.properties'
  }
  if ($children.Count -gt 0) {
    throw 'Android release signing root contains incomplete or unrecognized content; preserving it for manual review'
  }
}

function Remove-EmptyDirectoryCreatedThisRun([string]$Path, [bool]$CreatedThisRun) {
  if (-not $CreatedThisRun -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    return
  }
  if (@(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop).Count -eq 0) {
    Remove-Item -LiteralPath $Path -Force
  }
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedSigningRoot = Resolve-NormalizedPath $SigningRoot 'Android release signing root'
if (Test-PathWithin $resolvedSigningRoot $sourceRoot) {
  throw 'Android release signing material must be stored outside the source repository'
}

$resolvedJavaHome = Resolve-NormalizedPath (Find-JavaHome) 'JAVA_HOME'
$keytool = Join-Path $resolvedJavaHome 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool -PathType Leaf)) {
  throw "JDK 17 keytool is missing: $keytool"
}

$keystorePath = Join-Path $resolvedSigningRoot 'baobao-today-release.jks'
$keyPropertiesPath = Join-Path $resolvedSigningRoot 'key.properties'

if ($DryRun) {
  [ordered]@{
    Mode = 'key-setup-dry-run'
    SigningRoot = $resolvedSigningRoot
    KeystorePath = $keystorePath
    KeyPropertiesPath = $keyPropertiesPath
    KeyAlias = $keyAlias
    KeyAlgorithm = $keyAlgorithm
    KeySize = $keySize
    ValidityDays = $validityDays
    PasswordInput = 'secure-interactive'
  } | ConvertTo-Json -Compress
  return
}

Assert-SigningRootCanInitialize $resolvedSigningRoot

$storePassword = $null
$keyPassword = $null
$temporaryKeystorePath = $null
$temporaryKeyPropertiesPath = $null
$createdSigningRoot = $false
$previousStorePassword = $env:BAOBAO_KEYTOOL_STORE_PASSWORD
$previousKeyPassword = $env:BAOBAO_KEYTOOL_KEY_PASSWORD
try {
  $storePassword = Read-ConfirmedPassword 'Keystore password'
  $keyPassword = Read-ConfirmedPassword 'Key password'

  if (-not (Test-Path -LiteralPath $resolvedSigningRoot)) {
    New-Item -ItemType Directory -Path $resolvedSigningRoot -Force | Out-Null
    $createdSigningRoot = $true
  }
  Set-PrivateDirectoryAcl $resolvedSigningRoot

  $initializationId = [guid]::NewGuid().ToString('N')
  $temporaryKeystorePath = Join-Path $resolvedSigningRoot ".baobao-today-release.init-$initializationId.jks"
  $temporaryKeyPropertiesPath = Join-Path $resolvedSigningRoot ".key.properties.init-$initializationId.tmp"
  $env:BAOBAO_KEYTOOL_STORE_PASSWORD = $storePassword
  $env:BAOBAO_KEYTOOL_KEY_PASSWORD = $keyPassword

  & $keytool -genkeypair -v -noprompt -storetype JKS -keystore $temporaryKeystorePath -alias $keyAlias `
    -keyalg $keyAlgorithm -keysize $keySize -validity $validityDays `
    -dname 'CN=Baobao Today, OU=Mobile, O=Baobao Today, L=Shanghai, ST=Shanghai, C=CN' `
    '-storepass:env' 'BAOBAO_KEYTOOL_STORE_PASSWORD' `
    '-keypass:env' 'BAOBAO_KEYTOOL_KEY_PASSWORD'
  if ($LASTEXITCODE -ne 0) {
    throw "keytool failed with exit code $LASTEXITCODE"
  }

  & $keytool -list -keystore $temporaryKeystorePath -alias $keyAlias `
    '-storepass:env' 'BAOBAO_KEYTOOL_STORE_PASSWORD' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "keytool validation failed with exit code $LASTEXITCODE"
  }

  $propertyLines = @(
    "storeFile=$(ConvertTo-JavaPropertyValue ($keystorePath -replace '\\', '/'))"
    "storePassword=$(ConvertTo-JavaPropertyValue $storePassword)"
    "keyAlias=$keyAlias"
    "keyPassword=$(ConvertTo-JavaPropertyValue $keyPassword)"
  )
  [IO.File]::WriteAllLines(
    $temporaryKeyPropertiesPath,
    $propertyLines,
    (New-Object Text.UTF8Encoding($false))
  )

  if (Test-Path -LiteralPath $keystorePath -PathType Leaf) {
    throw 'Refusing to overwrite the existing Android release keystore'
  }
  if (Test-Path -LiteralPath $keyPropertiesPath -PathType Leaf) {
    throw 'Refusing to overwrite the existing Android release key.properties'
  }
  Move-Item -LiteralPath $temporaryKeystorePath -Destination $keystorePath
  $temporaryKeystorePath = $null
  Move-Item -LiteralPath $temporaryKeyPropertiesPath -Destination $keyPropertiesPath
  $temporaryKeyPropertiesPath = $null
  Set-PrivateDirectoryAcl $resolvedSigningRoot
} catch {
  if ($temporaryKeyPropertiesPath -and (Test-Path -LiteralPath $temporaryKeyPropertiesPath -PathType Leaf)) {
    Remove-Item -LiteralPath $temporaryKeyPropertiesPath -Force
  }
  if ($temporaryKeystorePath -and (Test-Path -LiteralPath $temporaryKeystorePath -PathType Leaf)) {
    $temporaryKeystore = Get-Item -LiteralPath $temporaryKeystorePath -Force
    if ($temporaryKeystore.Length -eq 0) {
      Remove-Item -LiteralPath $temporaryKeystorePath -Force
    } else {
      Write-Warning "A non-empty temporary keystore was preserved for manual review: $temporaryKeystorePath"
    }
  }
  Remove-EmptyDirectoryCreatedThisRun $resolvedSigningRoot $createdSigningRoot
  throw
} finally {
  $env:BAOBAO_KEYTOOL_STORE_PASSWORD = $previousStorePassword
  $env:BAOBAO_KEYTOOL_KEY_PASSWORD = $previousKeyPassword
  $storePassword = $null
  $keyPassword = $null
}

[ordered]@{
  Mode = 'key-setup-complete'
  SigningRoot = $resolvedSigningRoot
  KeystorePath = $keystorePath
  KeyPropertiesPath = $keyPropertiesPath
  KeyAlias = $keyAlias
  BackupRequired = $true
} | ConvertTo-Json -Compress
