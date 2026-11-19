const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { compileModsAsync, XML } = require('@expo/config-plugins');

const pluginPath = path.join(__dirname, '../plugins/with-local-only-backup.cjs');
// Before implementation, compile the unmodified fixture to exercise the RED baseline.
const withLocalOnlyBackup = fs.existsSync(pluginPath) ? require(pluginPath) : (config) => config;
const domains = ['root', 'file', 'database', 'sharedpref', 'external',
  'device_root', 'device_file', 'device_database', 'device_sharedpref'];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bbt-local-only-backup-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('bbt-local-only-backup-'));
    if (process.platform === 'win32') {
      const result = spawnSync('pwsh', ['-NoProfile', '-Command',
        'Remove-Item -LiteralPath $env:BBT_BACKUP_RULE_TEST_ROOT -Recurse -Force -ErrorAction Stop'],
      { env: { ...process.env, BBT_BACKUP_RULE_TEST_ROOT: root }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    } else fs.rmSync(root, { recursive: true });
  });
  const main = path.join(root, 'android/app/src/main');
  fs.mkdirSync(path.join(main, 'res/xml'), { recursive: true });
  fs.writeFileSync(path.join(main, 'res/xml/unrelated.xml'), '<unrelated value="preserve"/>');
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="test.local">
  <uses-permission android:name="android.permission.VIBRATE"/>
  <application android:name=".MainApplication" android:allowBackup="true" android:label="Keep me" android:theme="@style/Theme">
    <meta-data android:name="keep" android:value="value"/>
    <activity android:name=".MainActivity" android:exported="true"/>
  </application>
</manifest>`);
  return { root, main };
}

async function compile(root) {
  const config = withLocalOnlyBackup({ name: 'fixture', slug: 'fixture', android: { package: 'test.local', allowBackup: false } });
  return compileModsAsync(config, { projectRoot: root, platforms: ['android'] });
}

function assertExcluded(section) {
  assert(section, 'backup section must exist');
  assert.equal(section.include, undefined);
  assert.deepEqual(section.exclude.map((entry) => entry.$).sort((a, b) => a.domain.localeCompare(b.domain)),
    domains.map((domain) => ({ domain, path: '.' })).sort((a, b) => a.domain.localeCompare(b.domain)));
}

test('app configuration explicitly registers the local-only policy and disables system backup', () => {
  const config = require('../app.json').expo;
  assert.equal(config.android.allowBackup, false);
  assert(config.plugins.includes('./plugins/with-local-only-backup.cjs'));
});

test('Expo compileMods writes manifest references and all nine exclusions for legacy, cloud and transfer', async (t) => {
  const { root, main } = fixture(t);
  await compile(root);
  const manifest = await XML.readXMLAsync({ path: path.join(main, 'AndroidManifest.xml') });
  const app = manifest.manifest.application[0];
  assert.equal(app.$['android:allowBackup'], 'false');
  const legacy = app.$['android:fullBackupContent'];
  const modern = app.$['android:dataExtractionRules'];
  assert.match(legacy, /^@xml\/local_only_backup_rules$/);
  assert.match(modern, /^@xml\/local_only_data_extraction_rules$/);
  const readRule = (reference) => XML.readXMLAsync({ path: path.join(main, 'res', reference.slice(1) + '.xml') });
  assertExcluded((await readRule(legacy))['full-backup-content']);
  const rules = (await readRule(modern))['data-extraction-rules'];
  assertExcluded(rules['cloud-backup'][0]);
  assertExcluded(rules['device-transfer'][0]);
  assert.equal(app.$['android:label'], 'Keep me');
  assert.equal(app.$['android:theme'], '@style/Theme');
  assert.equal(app['meta-data'][0].$['android:value'], 'value');
  assert.equal(app.activity[0].$['android:exported'], 'true');
  assert.equal(manifest.manifest['uses-permission'][0].$['android:name'], 'android.permission.VIBRATE');
  assert.equal(fs.readFileSync(path.join(main, 'res/xml/unrelated.xml'), 'utf8'), '<unrelated value="preserve"/>');
});

test('repeated prebuild produces identical manifest and resources without duplicate rules', async (t) => {
  const { root, main } = fixture(t);
  const files = ['AndroidManifest.xml', 'res/xml/local_only_backup_rules.xml', 'res/xml/local_only_data_extraction_rules.xml'];
  await compile(root);
  const before = files.map((file) => fs.readFileSync(path.join(main, file), 'utf8'));
  await compile(root);
  assert.deepEqual(files.map((file) => fs.readFileSync(path.join(main, file), 'utf8')), before);
});
