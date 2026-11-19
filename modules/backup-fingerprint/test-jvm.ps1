[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new output directory so previous test evidence is preserved.' }
$modulePath = [IO.Path]::GetFullPath($PSScriptRoot)
$projectPath = [IO.Path]::GetFullPath((Join-Path $modulePath '..\..')).TrimEnd('\')
if ($outputPath.Equals($projectPath, [StringComparison]::OrdinalIgnoreCase) -or
    $outputPath.StartsWith($projectPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Keep generated JVM classes and test output outside the repository.'
}
New-Item -ItemType Directory -Path $outputPath | Out-Null
$main = Join-Path $modulePath 'android\src\main\java\expo\modules\backupfingerprint\StreamingSha256.java'
$tests = Join-Path $modulePath 'android\src\test\java\expo\modules\backupfingerprint\StreamingSha256Test.java'
& javac -encoding UTF-8 -d $outputPath $main $tests 2>&1 | Tee-Object -FilePath (Join-Path $outputPath 'compile.log')
if ($LASTEXITCODE -ne 0) { throw "JVM compilation failed: $LASTEXITCODE" }
& java -cp $outputPath expo.modules.backupfingerprint.StreamingSha256Test 2>&1 |
  Tee-Object -FilePath (Join-Path $outputPath 'test.log')
if ($LASTEXITCODE -ne 0) { throw "JVM tests failed: $LASTEXITCODE" }
