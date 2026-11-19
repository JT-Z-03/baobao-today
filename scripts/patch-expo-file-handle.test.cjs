const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const patchScript = path.join(__dirname, 'patch-expo-file-handle.cjs');
const relativeSource = 'node_modules/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemFileHandle.kt';
// Git may check out the fixture with CRLF; npm's upstream Kotlin file uses LF.
const original = fs.readFileSync(path.join(__dirname, 'fixtures/expo-file-system-57.0.7-FileSystemFileHandle.kt'), 'utf8').replaceAll('\r\n', '\n');

function fixture(t, version = '57.0.7', source = original) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bbt-file-handle-patch-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('bbt-file-handle-patch-'));
    const cleanup = spawnSync('pwsh', ['-NoProfile', '-Command', "Remove-Item -LiteralPath $env:BBT_PATCH_TEST_ROOT -Recurse -Force -ErrorAction Stop"], { env: { ...process.env, BBT_PATCH_TEST_ROOT: root }, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
  });
  const target = path.join(root, relativeSource);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
  fs.writeFileSync(path.join(root, 'node_modules/expo-file-system/package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'patch-fixture', version: '1.0.0',
    expo: { autolinking: { android: { buildFromSource: ['expo-file-system'] } } },
  }));
  fs.mkdirSync(path.join(root, 'scripts'));
  if (fs.existsSync(patchScript)) fs.copyFileSync(patchScript, path.join(root, 'scripts/patch-expo-file-handle.cjs'));
  return { root, target };
}

function runPatch(root) {
  // Before the patch exists, exercise the unmodified upstream file as the RED baseline.
  if (!fs.existsSync(patchScript)) return { status: 0, stdout: '', stderr: '' };
  return spawnSync(process.execPath, [path.join(root, 'scripts/patch-expo-file-handle.cjs')], { cwd: os.tmpdir(), encoding: 'utf8' });
}

function runNpm(root, script) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  return spawnSync(process.execPath, [npmCli, 'run', script], { cwd: root, encoding: 'utf8' });
}

test('patch keeps the content descriptor owned by both read and write streams', (t) => {
  const { root, target } = fixture(t);
  const result = runPatch(root);
  assert.equal(result.status, 0, result.stderr);
  const patched = fs.readFileSync(target, 'utf8');
  assert.match(patched, /FileMode\.READ -> ParcelFileDescriptor\.AutoCloseInputStream\(pfd\)\.channel/);
  assert.match(patched, /FileMode\.WRITE, FileMode\.APPEND, FileMode\.TRUNCATE -> ParcelFileDescriptor\.AutoCloseOutputStream\(pfd\)\.channel/);
  assert.doesNotMatch(patched, /File(?:Input|Output)Stream\(pfd\.fileDescriptor\)/);
  const originalFactory = original.indexOf('    fun forContentURI(');
  const patchedFactory = patched.indexOf('    fun forContentURI(');
  assert.equal(patched.slice(patched.indexOf('  private val fileChannel:')), original.slice(original.indexOf('  private val fileChannel:')));
  assert.equal(patched.slice(patched.indexOf('enum class FileMode'), patchedFactory), original.slice(original.indexOf('enum class FileMode'), originalFactory));
  assert(patched.indexOf('if (mode == FileMode.READ_WRITE)') < patched.indexOf('contentResolver.openFileDescriptor'));
  assert.match(patched, /catch \(error: Throwable\)[\s\S]*pfd\.close\(\)[\s\S]*error\.addSuppressed\(closeError\)[\s\S]*throw error/);
});

test('a second run preserves the patched bytes and does not write the file', (t) => {
  const { root, target } = fixture(t);
  assert.equal(runPatch(root).status, 0);
  const patched = fs.readFileSync(target);
  fs.utimesSync(target, new Date('2020-01-01'), new Date('2020-01-01'));
  const before = fs.statSync(target).mtimeMs;
  const second = runPatch(root);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already patched/);
  assert.deepEqual(fs.readFileSync(target), patched);
  assert.equal(fs.statSync(target).mtimeMs, before);
});

for (const [name, version, source, message] of [
  ['new upstream version', '57.0.8', original, /version/],
  ['source drift', '57.0.7', `${original}// drift\n`, /SHA-256/],
]) {
  test(`rejects ${name} without writing any source bytes`, (t) => {
    const { root, target } = fixture(t, version, source);
    fs.utimesSync(target, new Date('2020-01-01'), new Date('2020-01-01'));
    const before = fs.statSync(target).mtimeMs;
    const result = runPatch(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(fs.readFileSync(target, 'utf8'), source);
    assert.equal(fs.statSync(target).mtimeMs, before);
  });
}

test('rejects drift after patching rather than accepting a partial marker', (t) => {
  const { root, target } = fixture(t);
  assert.equal(runPatch(root).status, 0);
  const changed = `${fs.readFileSync(target, 'utf8')}// unexpected change\n`;
  fs.writeFileSync(target, changed);
  assert.notEqual(runPatch(root).status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), changed);
});

for (const [name, buildFromSource] of [
  ['missing selection', undefined],
  ['empty selection', []],
  ['a different module', ['expo-asset']],
  ['all modules', ['.*']],
]) {
  test(`rejects ${name} before modifying Kotlin`, (t) => {
    const { root, target } = fixture(t);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ expo: { autolinking: { android: { buildFromSource } } } }));
    fs.utimesSync(target, new Date('2020-01-01'), new Date('2020-01-01'));
    const before = fs.statSync(target).mtimeMs;
    const result = runPatch(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /buildFromSource/);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.statSync(target).mtimeMs, before);
  });
}

test('does not accept already patched Kotlin after source-build selection is removed', (t) => {
  const { root, target } = fixture(t);
  assert.equal(runPatch(root).status, 0);
  const patched = fs.readFileSync(target);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const result = runPatch(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /buildFromSource/);
  assert.deepEqual(fs.readFileSync(target), patched);
});

test('allows other explicitly selected source modules alongside FileSystem', (t) => {
  const { root, target } = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ expo: { autolinking: { android: { buildFromSource: ['expo-file-system', 'expo-asset'] } } } }));
  const result = runPatch(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(target, 'utf8'), /AutoCloseInputStream\(pfd\)/);
});

test('installed SDK resolver selects FileSystem and SQLite for Android source builds', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const cli = path.join(projectRoot, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js');
  const result = spawnSync(process.execPath, [cli, 'resolve', '--platform', 'android', '--project-root', projectRoot, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.deepEqual(resolved.configuration?.buildFromSource, ['expo-file-system', 'expo-sqlite']);
  assert(resolved.modules.some((module) => module.packageName === 'expo-sqlite'));
  const filesystem = resolved.modules.find((module) => module.packageName === 'expo-file-system');
  assert(filesystem, 'The patched FileSystem package must actually be linked');
  assert.equal(filesystem.projects.length, 1);
  assert.equal(filesystem.projects[0].name, 'expo-file-system');
});

test('npm postinstall runs the real patch in the installed project', (t) => {
  const { root, target } = fixture(t);
  const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).scripts;
  const fixturePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...fixturePackage, scripts }));
  const result = runNpm(root, 'postinstall');
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(target, 'utf8'), /AutoCloseInputStream\(pfd\)/);
});

test('npm run android applies the patch first even when install scripts were skipped', (t) => {
  const { root } = fixture(t);
  const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).scripts;
  // Exercise npm's real preandroid lifecycle without starting Expo or a device.
  scripts.android = `node -e "const fs=require('fs');if(!fs.readFileSync('${relativeSource}','utf8').includes('AutoCloseInputStream(pfd)'))process.exit(3)"`;
  const fixturePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...fixturePackage, scripts }));
  const result = runNpm(root, 'android');
  assert.equal(result.status, 0, result.stderr);
});

test('the local build invokes the patch before prebuild and stops on drift', (t) => {
  const { root, target } = fixture(t);
  const command = `
$ErrorActionPreference = 'Stop'
$ast = [Management.Automation.Language.Parser]::ParseFile($env:BBT_PATCH_TEST_BUILD_SCRIPT, [ref]$null, [ref]$null)
$calls = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'node' -and $node.Extent.Text.Contains('patch-expo-file-handle.cjs') }, $true))
if ($calls.Count -ne 1) { throw 'Expected exactly one file-handle patch invocation' }
$prebuild = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'npx' -and $node.Extent.Text.Contains('expo prebuild') }, $true))[0]
if ($calls[0].Extent.StartOffset -ge $prebuild.Extent.StartOffset) { throw 'Patch must precede prebuild' }
$pipeline = $calls[0].Parent
$statements = $pipeline.Parent.Statements
$guard = $statements[[Array]::IndexOf($statements, $pipeline) + 1]
if ($guard -isnot [Management.Automation.Language.IfStatementAst]) { throw 'Patch exit code guard is missing' }
$resolvedBuildRoot = $env:BBT_PATCH_TEST_ROOT
Invoke-Expression $pipeline.Extent.Text
Invoke-Expression $guard.Extent.Text
`;
  const options = { encoding: 'utf8', env: { ...process.env, BBT_PATCH_TEST_ROOT: root, BBT_PATCH_TEST_BUILD_SCRIPT: path.join(__dirname, 'android-local-build.ps1') } };
  const run = () => spawnSync('pwsh', ['-NoProfile', '-Command', command], options);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(fs.readFileSync(target, 'utf8'), /AutoCloseInputStream\(pfd\)/);
  fs.appendFileSync(target, '// drift\n');
  const failed = run();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /file-handle compatibility check failed/);
});
