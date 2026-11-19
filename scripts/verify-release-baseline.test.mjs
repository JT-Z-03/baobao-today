import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReleaseBaseline } from './verify-release-baseline.mjs';

function fixture() {
  const base = 'https://github.com/JT-Z-03/baobao-today/releases';
  const links = `[APK](${base}/download/v1.2.1/baobao-today-1.2.1-code9.apk) [SHA256SUMS.txt](${base}/download/v1.2.1/SHA256SUMS.txt) [发布页](${base}/tag/v1.2.1)`;
  return {
    app: { expo: { version: '1.2.1', android: { versionCode: 9 } } },
    pkg: { version: '1.2.1' },
    lock: { version: '1.2.1', packages: { '': { version: '1.2.1' },
      'node_modules/expo': { version: '57.0.31' }, 'node_modules/react-native': { version: '0.86.3' }, 'node_modules/react': { version: '19.2.3' },
      'node_modules/typescript': { version: '6.0.3' }, 'node_modules/expo-router': { version: '57.0.29' }, 'node_modules/expo-sqlite': { version: '57.0.4' },
      'node_modules/jest': { version: '29.7.0' }, 'node_modules/jest-expo': { version: '57.0.6' },
    } },
    readme: `## 下载与安装\n下载宝宝今天 1.2.1 ${links}\n当前安装包为 \`1.2.1 / code 9\`\n## 技术栈\n- Expo SDK 57.0.31\n- React Native 0.86.3 / React 19.2.3\n- TypeScript 6.0.3 / Expo Router 57.0.29\n- Expo SQLite 57.0.4\n- Jest 29.7.0 / jest-expo 57.0.6\n## 历史\n历史1.1.1/code6\n`,
    security: '## 支持范围\n当前已发布维护版本为 Android `1.2.1`（`versionCode=9`）。\n## 历史\n1.1.1/code6',
    releases: `# 更新记录\n## 未发布\n未来优化\n<!-- published-release:start -->\n## 2026-10-10 · 1.2.1 / code 9\n${links}\n<!-- published-release:end -->\n## 2026-09-12 · 1.1.1 / code 6\n历史发布\n`,
  };
}

test('published history remains independent of newer unshipped source', () => {
  const input = fixture();
  input.app.expo.version = input.pkg.version = input.lock.version = input.lock.packages[''].version = '1.3.0';
  input.app.expo.android.versionCode = 10;
  assert.deepEqual(verifyReleaseBaseline(input), { source: '1.3.0/code10', published: '1.2.1/code9' });
});

for (const [name, mutate] of [
  ['wrong download target despite correct source version', (input) => { input.readme = input.readme.replaceAll('/download/v1.2.1/', '/download/v1.3.0/'); }],
  ['stale APK code', (input) => { input.readme = input.readme.replace('code9.apk', 'code8.apk'); }],
  ['stale security maintenance scope', (input) => { input.security = input.security.replace('versionCode=9', 'versionCode=6'); }],
  ['dependency table differs from lockfile', (input) => { input.readme = input.readme.replace('57.0.31', '57.0.27'); }],
  ['source manifests disagree', (input) => { input.lock.packages[''].version = '1.1.1'; }],
  ['missing or duplicate published block', (input) => { input.releases += '<!-- published-release:start -->'; }],
]) {
  test(`rejects ${name}`, () => {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyReleaseBaseline(input));
  });
}
