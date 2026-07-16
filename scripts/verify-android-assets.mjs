import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assetContract = {
  'assets/images/icon.png': '19e6e82a7e8251ac5028aeb214b158ddf87117508aee2d77f53f8d442a631895',
  'assets/images/android-icon-background.png': 'd46dbab73d121eaed7d78f73d15f2c81a81bd54aa7b368d7f008567db622479e',
  'assets/images/android-icon-foreground.png': '4db18526f13978fb31952be522a4ab7777104f6bb7943b76bfc64c61bb0260eb',
  'assets/images/android-icon-monochrome.png': 'e087978f5a709b2c5ed84b37cfe42adea6d6cd4e6112eaaae1c1679090f61068',
  'assets/images/splash-icon.png': 'afe870e50b891b853055f71a227009be656c100a15628db63d80dcf9db851e8f',
  'assets/images/splash-icon-dark.png': '8d119105c00b0d4b205d888d679abae3961ec46a158fee07c616a7a5992978eb',
};

const appJson = JSON.parse(await readFile(path.join(projectRoot, 'app.json'), 'utf8'));
const { expo } = appJson;

assert.equal(expo.name, '宝宝今天');
assert.equal(expo.slug, 'baobao-today');
assert.equal(expo.version, '1.0.1');
assert.equal(expo.scheme, 'baobaotoday');
assert.equal(expo.icon, './assets/images/icon.png');
assert.equal(expo.owner, undefined, 'Public app config must not contain a private Expo owner.');
assert.equal(expo.extra?.eas, undefined, 'Public app config must not contain a private EAS project association.');
assert.equal(expo.ios?.icon, undefined, 'Public app config must not reference the excluded Expo template icon.');
assert.equal(expo.web?.favicon, './assets/images/icon.png');

assert.equal(expo.android?.package, 'com.baobaotoday.app');
assert.equal(expo.android?.versionCode, 4);
assert.deepEqual(expo.android?.blockedPermissions, [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
]);
assert.deepEqual(expo.android?.adaptiveIcon, {
  backgroundColor: '#FDC41A',
  foregroundImage: './assets/images/android-icon-foreground.png',
  backgroundImage: './assets/images/android-icon-background.png',
  monochromeImage: './assets/images/android-icon-monochrome.png',
});

const splashPlugin = expo.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
);
assert.ok(splashPlugin, 'expo-splash-screen config is required.');
assert.deepEqual(splashPlugin[1], {
  backgroundColor: '#F5F7F4',
  image: './assets/images/splash-icon.png',
  imageWidth: 160,
  resizeMode: 'contain',
  dark: {
    backgroundColor: '#101311',
    image: './assets/images/splash-icon-dark.png',
  },
});

for (const [relativePath, expectedHash] of Object.entries(assetContract)) {
  const bytes = await readFile(path.join(projectRoot, relativePath));
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relativePath} must be a PNG file.`,
  );
  assert.equal(bytes.readUInt32BE(16), 1024, `${relativePath} must be 1024 px wide.`);
  assert.equal(bytes.readUInt32BE(20), 1024, `${relativePath} must be 1024 px high.`);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expectedHash,
    `${relativePath} does not match the sealed Android 1.0 brand asset.`,
  );
}

console.log(`Android asset contract verified (${Object.keys(assetContract).length} PNG files).`);
