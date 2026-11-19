/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.join(__dirname, 'patch-expo-drive-root.cjs');
const fixtureRoot = path.join(__dirname, 'fixtures/expo-modules-autolinking-57.0.18');
const sources = {
  'commands/autolinkingOptions.js': '569debd22698218c0543a69ec7b0c3c76207d70bb72dbd0c7414ddd2820a98cd',
  'exports.js': '7d966e4c4933b45779f2f4e1db062da6bf5828c9a958ee954489a070107b3b47',
  'commands/reactNativeConfigCommand.js': 'd1ee09934b9c64ef84538c9b86fbfa035f41fbec572fa4201df97380c7d80397',
  'commands/resolveCommand.js': '1aeb875da813f1c19be803ab89c20a79cfde78b0add758997f9e1bb741b5b186',
};
const original = Object.fromEntries(Object.keys(sources).map((relative) => [relative,
  fs.readFileSync(path.join(fixtureRoot, `${path.basename(relative)}.txt`), 'utf8').replaceAll('\r\n', '\n'),
]));
const hash = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t, version = '57.0.18', omitted) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bbt-drive-root-patch-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('bbt-drive-root-patch-'));
    const cleanup = spawnSync('pwsh', ['-NoProfile', '-Command',
      'Remove-Item -LiteralPath $env:BBT_PATCH_TEST_ROOT -Recurse -Force -ErrorAction Stop'],
    { env: { ...process.env, BBT_PATCH_TEST_ROOT: root }, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
  });
  const packageRoot = path.join(root, 'node_modules/expo-modules-autolinking');
  for (const [relative, source] of Object.entries(original)) {
    if (relative === omitted) continue;
    const file = path.join(packageRoot, 'build', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'expo-modules-autolinking', version }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(script, path.join(root, 'scripts/patch-expo-drive-root.cjs'));
  return { root, packageRoot, file: (relative) => path.join(packageRoot, 'build', relative) };
}

function runPatch(root, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/patch-expo-drive-root.cjs')], { cwd, encoding: 'utf8' });
}

function snapshot(f) {
  return Object.keys(sources).map((relative) => {
    const target = f.file(relative);
    if (!fs.existsSync(target)) return null;
    fs.utimesSync(target, new Date('2020-01-01'), new Date('2020-01-01'));
    return { bytes: fs.readFileSync(target), mtimeMs: fs.statSync(target).mtimeMs };
  });
}

function assertUnchanged(f, before) {
  Object.keys(sources).forEach((relative, index) => {
    if (!before[index]) return assert.equal(fs.existsSync(f.file(relative)), false);
    assert.deepEqual(fs.readFileSync(f.file(relative)), before[index].bytes, relative);
    assert.equal(fs.statSync(f.file(relative)).mtimeMs, before[index].mtimeMs, relative);
  });
}

// Run complete upstream files. Only dependencies/OS boundaries are stubbed, so
// tests exercise Expo's actual public loaders and command actions, not regex snippets.
function load(source, dependencies = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(source, {
    exports, process: { cwd: () => 'R:\\', env },
    require: (name) => dependencies[name] ?? {},
    console: dependencies.console ?? console,
  }, { timeout: 1000 });
  return exports;
}

function rootApi(source, packagePaths, pathApi = path.win32) {
  const visited = [];
  const api = load(source, {
    path: pathApi,
    fs: { existsSync(file) {
      visited.push(file);
      assert(visited.length < 30, 'root traversal must terminate');
      return packagePaths.includes(file) || !file.endsWith('package.json');
    } },
  });
  return { api, visited };
}

async function jsonOutput(source, command, payload, env) {
  let action;
  const lines = [];
  const cli = { command: () => cli, option: () => cli, action(fn) { action = fn; return cli; } };
  const loader = {
    getPlatformOptions: async () => ({}), getAppRoot: async () => 'R:\\', getCommandRoot: () => 'R:\\',
  };
  const api = load(source, {
    './autolinkingOptions': { registerAutolinkingArguments: () => cli, createAutolinkingOptionsLoader: () => loader },
    '../reactNativeConfig': { createReactNativeConfigAsync: async () => payload },
    '../autolinking/findModules': { findModulesAsync: async () => ({}) },
    '../autolinking/resolveModules': {
      resolveModulesAsync: async () => [payload], resolveExtraBuildDependenciesAsync: async () => [],
    },
    '../autolinking/getConfiguration': { getConfiguration: () => undefined },
    console: { log: (line) => lines.push(line) },
  }, env);
  api[command](cli);
  await action([], { json: true, platform: 'android' });
  assert.equal(lines.length, 1);
  const result = JSON.parse(lines[0]);
  return command === 'resolveCommand' ? result.modules[0] : result;
}

test('fixtures preserve the four reviewed npm source hashes', () => {
  for (const [relative, expected] of Object.entries(sources)) assert.equal(hash(original[relative]), expected);
});

test('clean SDK 57 upstream still skips a Windows drive root in both public loaders', async () => {
  const options = rootApi(original['commands/autolinkingOptions.js'], ['R:\\package.json']);
  await assert.rejects(options.api.createAutolinkingOptionsLoader({ projectRoot: 'R:\\' }).getAppRoot(), /Couldn't find/);
  const legacy = rootApi(original['exports.js'], ['R:\\package.json']);
  assert.throws(() => legacy.api.findProjectRootSync('R:\\'), /Couldn't find/);
});

test('CLI resolves its own project even when invoked from another cwd', (t) => {
  const f = fixture(t);
  const result = runPatch(f.root, os.tmpdir());
  assert.equal(result.status, 0, result.stderr);
  for (const relative of Object.keys(sources)) assert.notEqual(hash(fs.readFileSync(f.file(relative))), sources[relative]);
});

test('second run performs no writes and preserves all patched bytes', (t) => {
  const f = fixture(t);
  assert.equal(runPatch(f.root).status, 0);
  const before = snapshot(f);
  const second = runPatch(f.root);
  assert.equal(second.status, 0, second.stderr);
  assertUnchanged(f, before);
  assert.match(second.stdout, /already patched/);
});

test('unknown upstream version fails before writing any file', (t) => {
  const f = fixture(t, '58.0.16');
  const before = snapshot(f);
  const result = runPatch(f.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version/);
  assertUnchanged(f, before);
});

for (const relative of Object.keys(sources)) {
  test(`unreviewed bytes in ${relative} reject the whole patch before any write`, (t) => {
    const f = fixture(t);
    fs.appendFileSync(f.file(relative), '\n// upstream drift\n');
    const before = snapshot(f);
    const result = runPatch(f.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256/);
    assertUnchanged(f, before);
  });
}

test('drift after a patched marker is preserved and rejected instead of truncated', (t) => {
  const f = fixture(t);
  assert.equal(runPatch(f.root).status, 0);
  fs.appendFileSync(f.file('commands/resolveCommand.js'), '\n// unknown new code\n');
  const before = snapshot(f);
  const result = runPatch(f.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256/);
  assertUnchanged(f, before);
});

test('a missing final target fails before modifying the preceding targets', (t) => {
  const f = fixture(t, '57.0.18', 'commands/resolveCommand.js');
  const before = snapshot(f);
  assert.notEqual(runPatch(f.root).status, 0);
  assertUnchanged(f, before);
});

test('known legacy output is upgraded to an absolute alias root and is then idempotent', (t) => {
  const f = fixture(t);
  assert.equal(runPatch(f.root).status, 0);
  const legacyHashes = {
    'commands/reactNativeConfigCommand.js': '86e742a24e70d9d7e2ea65ca63cac66c2d65b47f28bb751f40cf5e75ba9e8416',
    'commands/resolveCommand.js': 'f9a49e7bbf22820e344b1a9269cc121cd296135075a3bd44ec5ce9da686ecd38',
  };
  for (const [relative, expected] of Object.entries(legacyHashes)) {
    const legacy = fs.readFileSync(f.file(relative), 'utf8').replace(
      "? trim(normalize(to)) + (normalized.slice(source.length) || '/') : item;",
      '? trim(normalize(to)) + normalized.slice(source.length) : item;');
    // Independent hashes recorded from the previously installed patch prove
    // this reconstructs its entire source, not merely a similar marker.
    assert.equal(hash(legacy), expected);
    fs.writeFileSync(f.file(relative), legacy);
  }
  const result = runPatch(f.root);
  assert.equal(result.status, 0, result.stderr);
  const before = snapshot(f);
  assert.equal(runPatch(f.root).status, 0);
  assertUnchanged(f, before);
});

test('importing the patch does not write files or inspect the caller cwd', (t) => {
  const f = fixture(t);
  const before = snapshot(f);
  const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);',
    path.join(f.root, 'scripts/patch-expo-drive-root.cjs')], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assertUnchanged(f, before);
});

test('Windows SUBST fixture reproduces upstream failure then resolves the actual drive root',
  { skip: process.platform !== 'win32' }, async (t) => {
    const f = fixture(t);
    const aliases = spawnSync('subst.exe', [], { encoding: 'utf8' });
    assert.equal(aliases.status, 0, aliases.stderr);
    const letter = [...'RSTUVWXYZ'].find((value) => !fs.existsSync(`${value}:\\`) && !aliases.stdout.includes(`${value}:`));
    if (!letter) return t.skip('No free drive letter for isolated SUBST fixture');
    const alias = `${letter}:`;
    const aliasRoot = `${alias}\\`;
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: 'drive-root-fixture' }));
    fs.mkdirSync(path.join(f.root, 'nested'));
    const mounted = spawnSync('subst.exe', [alias, f.root], { encoding: 'utf8' });
    assert.equal(mounted.status, 0, mounted.stderr);
    try {
      const upstream = load(original['commands/autolinkingOptions.js'], { fs, path });
      await assert.rejects(upstream.createAutolinkingOptionsLoader({ projectRoot: aliasRoot }).getAppRoot(), /Couldn't find/);
      const result = runPatch(aliasRoot, aliasRoot);
      assert.equal(result.status, 0, result.stderr);
      const options = load(fs.readFileSync(f.file('commands/autolinkingOptions.js'), 'utf8'), { fs, path });
      assert.equal(await options.createAutolinkingOptionsLoader({ projectRoot: `${aliasRoot}nested` }).getAppRoot(), aliasRoot);
      const legacy = load(fs.readFileSync(f.file('exports.js'), 'utf8'), { fs, path });
      assert.equal(legacy.findProjectRootSync(aliasRoot), `${aliasRoot}package.json`);
    } finally {
      const unmounted = spawnSync('subst.exe', [alias, '/D'], { encoding: 'utf8' });
      assert.equal(unmounted.status, 0, unmounted.stderr);
    }
  });

test('a partially applied known patch can safely complete', (t) => {
  const f = fixture(t);
  assert.equal(runPatch(f.root).status, 0);
  fs.writeFileSync(f.file('exports.js'), original['exports.js']);
  const result = runPatch(f.root);
  assert.equal(result.status, 0, result.stderr);
  const before = snapshot(f);
  assert.equal(runPatch(f.root).status, 0);
  assertUnchanged(f, before);
});

test('patched public loaders find root/nested/nearest packages and terminate when absent', async (t) => {
  const f = fixture(t);
  assert.equal(runPatch(f.root).status, 0);
  const optionsSource = fs.readFileSync(f.file('commands/autolinkingOptions.js'), 'utf8');
  const legacySource = fs.readFileSync(f.file('exports.js'), 'utf8');
  for (const [start, packages, expected] of [
    ['R:\\', ['R:\\package.json'], 'R:\\'],
    ['R:\\nested\\child', ['R:\\package.json'], 'R:\\'],
    ['R:\\nested\\child', ['R:\\nested\\package.json', 'R:\\package.json'], 'R:\\nested'],
  ]) {
    const options = rootApi(optionsSource, packages);
    assert.equal(await options.api.createAutolinkingOptionsLoader({ projectRoot: start }).getAppRoot(), expected);
    const legacy = rootApi(legacySource, packages);
    assert.equal(legacy.api.findProjectRootSync(start), path.win32.join(expected, 'package.json'));
  }
  const options = rootApi(optionsSource, []);
  await assert.rejects(options.api.createAutolinkingOptionsLoader({ projectRoot: 'R:\\nested' }).getAppRoot(), /Couldn't find/);
  const legacy = rootApi(legacySource, []);
  assert.throws(() => legacy.api.findProjectRootSync('R:\\nested'), /Couldn't find/);
});

for (const command of ['reactNativeConfigCommand', 'resolveCommand']) {
  test(`${command} maps only paths in this project and keeps nested JSON values`, async (t) => {
    const f = fixture(t);
    const relative = `commands/${command}.js`;
    const payload = {
      root: 'D:\\示例工程', sourceDir: 'd:/示例工程/android',
      nested: ['D:\\示例工程\\node_modules\\模块', { path: 'D:/示例工程/photos/a.jpg' }],
      sibling: 'D:\\示例工程-other\\android', external: 'C:\\sdk\\android',
      url: 'https://example.com/D:/示例工程', scalar: [null, true, 42],
    };
    const env = { BBT_NATIVE_SOURCE_ROOT: 'D:\\示例工程\\', BBT_NATIVE_ALIAS_ROOT: 'R:\\' };
    // The clean command emits physical paths unchanged even with the SUBST env.
    assert.deepEqual(await jsonOutput(original[relative], command, payload, env), payload);
    assert.equal(runPatch(f.root).status, 0);
    const source = fs.readFileSync(f.file(relative), 'utf8');
    assert.deepEqual(await jsonOutput(source, command, payload, env), {
      ...payload, root: 'R:/', sourceDir: 'R:/android', nested: ['R:/node_modules/模块', { path: 'R:/photos/a.jpg' }],
    });
    assert.deepEqual(await jsonOutput(source, command, payload, {}), payload);
    assert.deepEqual(await jsonOutput(source, command, payload, { BBT_NATIVE_SOURCE_ROOT: env.BBT_NATIVE_SOURCE_ROOT }), payload);
  });
}
