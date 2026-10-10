$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'android-release-key-setup.ps1'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = Join-Path $env:TEMP "baobao-key-setup-test-$([guid]::NewGuid().ToString('N'))"

function Assert-Equal([string]$label, [object]$actual, [object]$expected) {
  if ($actual -ne $expected) {
    throw "$label expected '$expected', received '$actual'"
  }
}

function Assert-True([string]$label, [bool]$condition) {
  if (-not $condition) {
    throw $label
  }
}

function Find-TestJavaHome {
  foreach ($candidate in @($env:JAVA_HOME)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) `
      -and (Test-Path -LiteralPath (Join-Path $candidate 'bin\keytool.exe') -PathType Leaf)) {
      return $candidate
    }
  }

  $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft\OpenJDK17'
  $detected = Get-ChildItem -LiteralPath $installRoot -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue `
    | Sort-Object Name -Descending `
    | Select-Object -First 1
  if ($detected -and (Test-Path -LiteralPath (Join-Path $detected.FullName 'bin\keytool.exe') -PathType Leaf)) {
    return $detected.FullName
  }

  throw 'Microsoft OpenJDK 17 is required for the release key setup behavior tests'
}

function Install-ReadHostMock([object[]]$Responses) {
  $global:BaobaoKeySetupTestResponses = New-Object Collections.Queue
  foreach ($response in $Responses) {
    $global:BaobaoKeySetupTestResponses.Enqueue($response)
  }
  $global:BaobaoKeySetupTestReadCount = 0

  function global:Read-Host {
    param(
      [string]$Prompt,
      [switch]$AsSecureString
    )

    $global:BaobaoKeySetupTestReadCount += 1
    if ($global:BaobaoKeySetupTestResponses.Count -eq 0) {
      throw 'Read-Host was called more times than expected'
    }
    $response = $global:BaobaoKeySetupTestResponses.Dequeue()
    if ($null -eq $response) {
      return $null
    }
    $response = [string]$response
    if ($response -eq '__BAOBAO_TEST_INTERRUPT__') {
      throw (New-Object OperationCanceledException('Simulated user interruption'))
    }
    if (-not $AsSecureString) {
      return $response
    }
    if ($response.Length -eq 0) {
      return [Security.SecureString]::new()
    }
    return ConvertTo-SecureString $response -AsPlainText -Force
  }
}

function Remove-ReadHostMock {
  Remove-Item -LiteralPath Function:\global:Read-Host -ErrorAction SilentlyContinue
  Remove-Variable -Name BaobaoKeySetupTestResponses -Scope Global -ErrorAction SilentlyContinue
}

function Invoke-KeySetupWithResponses(
  [string]$SigningRoot,
  [string]$JavaHome,
  [object[]]$Responses
) {
  Install-ReadHostMock $Responses
  $records = @()
  $failure = $null
  try {
    $records = @(& $scriptPath -SigningRoot $SigningRoot -JavaHome $JavaHome)
  } catch {
    $failure = $_
  } finally {
    $readCount = $global:BaobaoKeySetupTestReadCount
    Remove-ReadHostMock
  }
  return [pscustomobject]@{
    Records = $records
    Failure = $failure
    ReadCount = $readCount
  }
}

function Set-ProtectedDaclFixture([string]$Path) {
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit `
    -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($sid in @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-18'))
  )) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$security.AddAccessRule($rule)
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $security)
}

function Assert-PropertyPasswordsAndSignature(
  [string]$SigningRoot,
  [string]$StorePassword,
  [string]$KeyPassword
) {
  $expectedPath = Join-Path $testRoot 'expected-passwords.properties'
  $expectedLines = @(
    "storePassword=$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($StorePassword)))"
    "keyPassword=$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($KeyPassword)))"
  )
  [IO.File]::WriteAllLines($expectedPath, $expectedLines, [Text.UTF8Encoding]::new($false))
  & (Join-Path $javaHome 'bin\java.exe') --source 17 $propertyProbePath `
    (Join-Path $SigningRoot 'key.properties') $expectedPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Real JDK Properties password round trip or keystore signature verification failed'
  }
}

try {
  $fakeJavaHome = Join-Path $testRoot 'fake-jdk-17'
  $fakeSigningRoot = Join-Path $testRoot 'dry-run-signing'
  New-Item -ItemType Directory -Path (Join-Path $fakeJavaHome 'bin') -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $fakeJavaHome 'bin\keytool.exe') -Force | Out-Null

  $dryRunJson = & $scriptPath -SigningRoot $fakeSigningRoot -JavaHome $fakeJavaHome -DryRun
  if ($dryRunJson -match 'storePassword|keyPassword|password=') {
    throw 'Key setup dry-run output contains password material'
  }
  $dryRun = $dryRunJson | ConvertFrom-Json
  Assert-Equal 'Dry-run mode' $dryRun.Mode 'key-setup-dry-run'
  Assert-Equal 'Key alias' $dryRun.KeyAlias 'baobao-today-release'
  Assert-Equal 'Key algorithm' $dryRun.KeyAlgorithm 'RSA'
  Assert-Equal 'Key size' ([string]$dryRun.KeySize) '4096'
  Assert-Equal 'Validity days' ([string]$dryRun.ValidityDays) '10000'
  Assert-Equal 'Password input' $dryRun.PasswordInput 'secure-interactive'
  Assert-True 'Key setup dry-run created the signing directory' (-not (Test-Path -LiteralPath $fakeSigningRoot))

  $insideRepositoryRejected = $false
  try {
    & $scriptPath -SigningRoot (Join-Path $sourceRoot 'release-signing') -JavaHome $fakeJavaHome -DryRun | Out-Null
  } catch {
    $insideRepositoryRejected = $_.Exception.Message -match 'must be stored outside the source repository'
  }
  Assert-True 'Key setup did not reject a signing directory inside the repository' $insideRepositoryRejected

  $shortPassword = '123456789012345'
  $shortRoot = Join-Path $testRoot 'short-password-signing'
  $shortResult = Invoke-KeySetupWithResponses $shortRoot $fakeJavaHome @($shortPassword, $shortPassword)
  Assert-True 'A 15-character password was not rejected' `
    ($shortResult.Failure -and $shortResult.Failure.Exception.Message -match 'at least 16')
  Assert-Equal '15-character password prompt count' $shortResult.ReadCount 2
  Assert-True 'A rejected 15-character password left a signing directory or partial file' `
    (-not (Test-Path -LiteralPath $shortRoot))
  $shortLog = (($shortResult.Records | Out-String) + ($shortResult.Failure | Out-String))
  Assert-True 'A rejected password appeared in output or error text' (-not $shortLog.Contains($shortPassword))

  $interruptedRoot = Join-Path $testRoot 'interrupted-signing'
  $interruptResult = Invoke-KeySetupWithResponses $interruptedRoot $fakeJavaHome @('__BAOBAO_TEST_INTERRUPT__')
  Assert-True 'Simulated user interruption was not surfaced' `
    ($interruptResult.Failure -and $interruptResult.Failure.Exception.Message -match 'Simulated user interruption')
  Assert-Equal 'Interrupted password prompt count' $interruptResult.ReadCount 1
  Assert-True 'User interruption left a signing directory or partial file' `
    (-not (Test-Path -LiteralPath $interruptedRoot))

  $retryResult = Invoke-KeySetupWithResponses $interruptedRoot $fakeJavaHome @('__BAOBAO_TEST_INTERRUPT__')
  Assert-True 'A retry after interruption did not reach the password prompt' `
    ($retryResult.Failure -and $retryResult.Failure.Exception.Message -match 'Simulated user interruption')
  Assert-Equal 'Retry password prompt count' $retryResult.ReadCount 1
  Assert-True 'A retry after interruption left a signing directory or partial file' `
    (-not (Test-Path -LiteralPath $interruptedRoot))

  $keytoolFailureRoot = Join-Path $testRoot 'keytool-failure-signing'
  $testStorePassword = 'BaobaoTestStore!2026'
  $testKeyPassword = 'BaobaoTestKey!!2026'
  $keytoolFailureResult = Invoke-KeySetupWithResponses $keytoolFailureRoot $fakeJavaHome @(
    $testStorePassword,
    $testStorePassword,
    $testKeyPassword,
    $testKeyPassword
  )
  Assert-True 'An invalid keytool executable did not fail setup' ([bool]$keytoolFailureResult.Failure)
  Assert-True 'A keytool startup failure left a signing directory or temporary file' `
    (-not (Test-Path -LiteralPath $keytoolFailureRoot))
  $keytoolFailureLog = (($keytoolFailureResult.Records | Out-String) + ($keytoolFailureResult.Failure | Out-String))
  Assert-True 'Keystore password appeared in keytool failure output' `
    (-not $keytoolFailureLog.Contains($testStorePassword))
  Assert-True 'Key password appeared in keytool failure output' `
    (-not $keytoolFailureLog.Contains($testKeyPassword))

  $scriptContent = Get-Content -Raw -LiteralPath $scriptPath -Encoding UTF8
  foreach ($requiredText in @(
    'Read-Host -AsSecureString',
    '-storepass:env',
    '-keypass:env',
    'SetAccessRuleProtection',
    'DirectoryInfo',
    'SetAccessControl'
  )) {
    Assert-True "Key setup script is missing security behavior: $requiredText" `
      ($scriptContent -match [regex]::Escape($requiredText))
  }
  foreach ($forbiddenText in @('Set-Acl', 'Get-Acl', 'AccessControlSections]::Audit', 'SetAuditRule', 'SetOwner')) {
    Assert-True "Key setup script uses a forbidden ACL operation: $forbiddenText" `
      ($scriptContent -notmatch [regex]::Escape($forbiddenText))
  }

  . $scriptPath -SigningRoot $fakeSigningRoot -JavaHome $fakeJavaHome -DryRun | Out-Null
  $aclRoot = Join-Path $testRoot 'acl-idempotence'
  New-Item -ItemType Directory -Path $aclRoot -Force | Out-Null
  Set-PrivateDirectoryAcl $aclRoot
  Set-PrivateDirectoryAcl $aclRoot
  $accessAcl = [IO.FileSystemAclExtensions]::GetAccessControl(
    [IO.DirectoryInfo]::new($aclRoot), [Security.AccessControl.AccessControlSections]::Access
  )
  Assert-True 'Private DACL was not protected from inheritance' $accessAcl.AreAccessRulesProtected
  Assert-Equal 'Private DACL explicit rule count' `
    @($accessAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])).Count 2

  $javaHome = Find-TestJavaHome
  $propertyProbePath = Join-Path $testRoot 'PropertyPasswordProbe.java'
  [IO.File]::WriteAllText($propertyProbePath, @'
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;
import java.util.Properties;

class PropertyPasswordProbe {
  static Properties load(String path) throws Exception {
    Properties values = new Properties();
    try (InputStream stream = Files.newInputStream(Path.of(path))) {
      values.load(stream);
    }
    return values;
  }

  public static void main(String[] args) throws Exception {
    Properties actual = load(args[0]);
    Properties expected = load(args[1]);
    for (String name : expected.stringPropertyNames()) {
      String value = new String(Base64.getDecoder().decode(expected.getProperty(name)), StandardCharsets.UTF_8);
      if (!value.equals(actual.getProperty(name))) {
        throw new AssertionError("Java Properties changed synthetic field: " + name);
      }
    }
    if (actual.getProperty("storeFile") != null) {
      KeyStore keys = KeyStore.getInstance("JKS");
      try (InputStream stream = Files.newInputStream(Path.of(actual.getProperty("storeFile")))) {
        keys.load(stream, actual.getProperty("storePassword").toCharArray());
      }
      String alias = actual.getProperty("keyAlias");
      PrivateKey privateKey = (PrivateKey) keys.getKey(alias, actual.getProperty("keyPassword").toCharArray());
      byte[] payload = "Synthetic release signing regression".getBytes(StandardCharsets.UTF_8);
      Signature signer = Signature.getInstance("SHA256withRSA");
      signer.initSign(privateKey);
      signer.update(payload);
      byte[] signature = signer.sign();
      signer.initVerify(keys.getCertificate(alias));
      signer.update(payload);
      if (!signer.verify(signature)) {
        throw new AssertionError("Synthetic keystore signature verification failed");
      }
      System.out.println("Real JDK Properties password load, keystore unlock, and signature: passed");
    } else {
      System.out.println("Real JDK Properties whitespace and escaping cases: passed (" + expected.size() + ")");
    }
  }
}
'@, [Text.UTF8Encoding]::new($false))
  $recoveredRoot = Join-Path $testRoot 'existing-empty-signing'
  New-Item -ItemType Directory -Path $recoveredRoot -Force | Out-Null
  Set-ProtectedDaclFixture $recoveredRoot
  $storePassword = $testStorePassword
  $keyPassword = $testKeyPassword
  $recoveredResult = Invoke-KeySetupWithResponses $recoveredRoot $javaHome @(
    $storePassword,
    $storePassword,
    $keyPassword,
    $keyPassword
  )
  Assert-True "Existing empty signing directory recovery failed: $($recoveredResult.Failure)" `
    (-not $recoveredResult.Failure)
  Assert-True 'Recovered setup did not create the test keystore' `
    (Test-Path -LiteralPath (Join-Path $recoveredRoot 'baobao-today-release.jks') -PathType Leaf)
  Assert-True 'Recovered setup did not create key.properties' `
    (Test-Path -LiteralPath (Join-Path $recoveredRoot 'key.properties') -PathType Leaf)
  $successLog = $recoveredResult.Records | Out-String
  Assert-True 'Keystore password appeared in successful output' (-not $successLog.Contains($storePassword))
  Assert-True 'Key password appeared in successful output' (-not $successLog.Contains($keyPassword))
  Assert-PropertyPasswordsAndSignature $recoveredRoot $storePassword $keyPassword

  $leadingSpaceRoot = Join-Path $testRoot 'leading-space-password-signing'
  $leadingSpaceStorePassword = '  BaobaoTestStore!2026'
  $leadingSpaceKeyPassword = ' BaobaoTestKey!!2026'
  $leadingSpaceResult = Invoke-KeySetupWithResponses $leadingSpaceRoot $javaHome @(
    $leadingSpaceStorePassword,
    $leadingSpaceStorePassword,
    $leadingSpaceKeyPassword,
    $leadingSpaceKeyPassword
  )
  Assert-True "Leading-space synthetic signing setup failed: $($leadingSpaceResult.Failure)" `
    (-not $leadingSpaceResult.Failure)
  Assert-PropertyPasswordsAndSignature $leadingSpaceRoot $leadingSpaceStorePassword $leadingSpaceKeyPassword

  $mixedSpaceRoot = Join-Path $testRoot 'mixed-space-password-signing'
  $mixedSpaceStorePassword = '  Baobao TestStore!2026  '
  $mixedSpaceKeyPassword = 'Baobao Test Key!!2026  '
  $mixedSpaceResult = Invoke-KeySetupWithResponses $mixedSpaceRoot $javaHome @(
    $mixedSpaceStorePassword,
    $mixedSpaceStorePassword,
    $mixedSpaceKeyPassword,
    $mixedSpaceKeyPassword
  )
  Assert-True "Mixed-space synthetic signing setup failed: $($mixedSpaceResult.Failure)" `
    (-not $mixedSpaceResult.Failure)
  Assert-Equal 'Mixed-space valid password prompt count' $mixedSpaceResult.ReadCount 4
  Assert-PropertyPasswordsAndSignature $mixedSpaceRoot $mixedSpaceStorePassword $mixedSpaceKeyPassword
  $mixedSpaceLog = $mixedSpaceResult.Records | Out-String
  Assert-True 'Mixed-space keystore password appeared in successful output' `
    (-not $mixedSpaceLog.Contains($mixedSpaceStorePassword))
  Assert-True 'Mixed-space key password appeared in successful output' `
    (-not $mixedSpaceLog.Contains($mixedSpaceKeyPassword))

  $propertyCases = [ordered]@{
    singleLeadingSpace = ' BaobaoTestValue!2026'
    multipleLeadingSpaces = '   BaobaoTestValue!2026'
    allSpaces = (' ' * 16)
    middleAndTrailingSpaces = 'Baobao Test Value!2026  '
    leadingTabAndSpace = "`t BaobaoTestValue!2026"
    leadingSpaceAndTab = " `tBaobaoTestValue!2026"
    backslashAndSeparators = ' \key=value:#!2026'
    unicodeAndControls = " 中文🍼`t`r`n\=:!"
  }
  $encodedCasesPath = Join-Path $testRoot 'encoded-cases.properties'
  $expectedCasesPath = Join-Path $testRoot 'expected-cases.properties'
  $encodedCases = @()
  $expectedCases = @()
  foreach ($entry in $propertyCases.GetEnumerator()) {
    $encodedCases += "$($entry.Key)=$(ConvertTo-JavaPropertyValue $entry.Value)"
    $expectedCases += "$($entry.Key)=$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($entry.Value)))"
  }
  [IO.File]::WriteAllLines($encodedCasesPath, $encodedCases, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllLines($expectedCasesPath, $expectedCases, [Text.UTF8Encoding]::new($false))
  & (Join-Path $javaHome 'bin\java.exe') --source 17 $propertyProbePath $encodedCasesPath $expectedCasesPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Real JDK Properties whitespace and escaping regression failed'
  }

  $keystorePath = Join-Path $recoveredRoot 'baobao-today-release.jks'
  $originalHash = (Get-FileHash -LiteralPath $keystorePath -Algorithm SHA256).Hash
  $overwriteResult = Invoke-KeySetupWithResponses $recoveredRoot $javaHome @('__BAOBAO_TEST_INTERRUPT__')
  Assert-True 'Existing keystore was not rejected before prompting' `
    ($overwriteResult.Failure -and $overwriteResult.Failure.Exception.Message -match 'Refusing to overwrite')
  Assert-Equal 'Existing keystore overwrite prompt count' $overwriteResult.ReadCount 0
  Assert-Equal 'Existing keystore hash after refused overwrite' `
    (Get-FileHash -LiteralPath $keystorePath -Algorithm SHA256).Hash $originalHash

  $gitignore = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot '.gitignore') -Encoding UTF8
  foreach ($requiredPattern in @('*.jks', '*.keystore', 'key.properties', '*.apk', '*.aab')) {
    Assert-True ".gitignore does not cover $requiredPattern" `
      ($gitignore -match [regex]::Escape($requiredPattern))
  }

  $invalidPasswordCases = @(
    [pscustomobject]@{ Name = 'missing'; Value = $null }
    [pscustomobject]@{ Name = 'empty'; Value = '' }
    [pscustomobject]@{ Name = 'ascii-spaces'; Value = (' ' * 16) }
    [pscustomobject]@{ Name = 'tabs'; Value = ("`t" * 16) }
    [pscustomobject]@{ Name = 'unicode-spaces'; Value = ([string][char]0x3000 * 16) }
  )
  $policyFailures = [Collections.Generic.List[string]]::new()
  foreach ($passwordPosition in @('store', 'key')) {
    foreach ($passwordCase in $invalidPasswordCases) {
      $caseName = "$passwordPosition/$($passwordCase.Name)"
      $invalidRoot = Join-Path $testRoot "rejected-$passwordPosition-$($passwordCase.Name)-signing"
      $responses = @($passwordCase.Value, $passwordCase.Value)
      $expectedReadCount = 2
      $expectedLabel = 'Keystore password'
      if ($passwordPosition -eq 'key') {
        $responses = @($testStorePassword, $testStorePassword) + $responses
        $expectedReadCount = 4
        $expectedLabel = 'Key password'
      }
      $invalidResult = Invoke-KeySetupWithResponses $invalidRoot $fakeJavaHome $responses
      $invalidLog = (($invalidResult.Records | Out-String) + ($invalidResult.Failure | Out-String))
      $checks = [ordered]@{
        PolicyMessage = [bool]($invalidResult.Failure -and
          $invalidResult.Failure.Exception.Message -match
            "^$expectedLabel must be provided and must not be empty or whitespace-only")
        ConfirmationReads = ($invalidResult.ReadCount -eq $expectedReadCount)
        NoSigningDirectory = (-not (Test-Path -LiteralPath $invalidRoot))
        NoValidPasswordLeak = (-not $invalidLog.Contains($testStorePassword))
      }
      foreach ($check in $checks.GetEnumerator()) {
        if (-not $check.Value) {
          $policyFailures.Add("$caseName/$($check.Key)")
        }
      }
      [ordered]@{ PasswordCase = $caseName; Checks = $checks } | ConvertTo-Json -Depth 3 -Compress | Write-Output
    }
  }
  Assert-Equal 'Invalid password creation policy failures' $policyFailures.Count 0

  Write-Output 'android release key setup recovery, DACL, password round trip, signature, overwrite, secrecy, and gitignore tests: passed'
} finally {
  Remove-ReadHostMock
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    $resolvedTempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notlike 'baobao-key-setup-test-*') {
      throw 'Refusing to remove a test directory outside the expected temporary root'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
