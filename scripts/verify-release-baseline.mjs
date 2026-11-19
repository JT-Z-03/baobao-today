import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function section(text, heading) {
  const start = `## ${heading}\n`;
  const normalized = text.replaceAll('\r\n', '\n');
  assert.equal(normalized.split(start).length, 2, `Expected one current section: ${heading}`);
  return normalized.split(start)[1].split('\n## ')[0];
}

export function verifyReleaseBaseline({ app, pkg, lock, readme, security, releases }) {
  const sourceVersion = app.expo.version;
  const sourceCode = app.expo.android.versionCode;
  assert.match(sourceVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isSafeInteger(sourceCode) && sourceCode > 0, 'Android versionCode must be a positive integer');
  for (const version of [pkg.version, lock.version, lock.packages[''].version]) {
    assert.equal(version, sourceVersion, 'Source app/package/lock versions disagree');
  }

  // Published facts are maintained independently of an unshipped source bump.
  // This is an offline consistency gate, not a claim about live GitHub assets.
  const start = '<!-- published-release:start -->';
  const end = '<!-- published-release:end -->';
  assert.equal(releases.split(start).length, 2, 'Expected one published-release start marker');
  assert.equal(releases.split(end).length, 2, 'Expected one published-release end marker');
  assert.ok(releases.indexOf(start) < releases.indexOf(end), 'Published block markers are out of order');
  const publishedBlock = releases.split(start)[1].split(end)[0];
  const headers = [...publishedBlock.matchAll(/^## \d{4}-\d{2}-\d{2} · (\d+\.\d+\.\d+) \/ code (\d+)\r?$/gm)];
  assert.equal(headers.length, 1, 'Published block must identify exactly one release');
  const [, publishedVersion, publishedCodeText] = headers[0];
  const publishedCode = Number(publishedCodeText);
  assert.ok(sourceCode >= publishedCode, 'Source versionCode is behind the documented published build');
  const base = `https://github.com/JT-Z-03/baobao-today/releases`;
  const expectedUrls = [
    `${base}/download/v${publishedVersion}/baobao-today-${publishedVersion}-code${publishedCode}.apk`,
    `${base}/download/v${publishedVersion}/SHA256SUMS.txt`,
    `${base}/tag/v${publishedVersion}`,
  ];
  const downloads = section(readme, '下载与安装');
  for (const [label, block] of [['README downloads', downloads], ['published release', publishedBlock]]) {
    const urls = [...block.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
    for (const url of expectedUrls) assert.ok(urls.includes(url), `${label} is missing the matching published URL: ${url}`);
    const assets = urls.filter((url) => url.includes('/releases/download/'));
    assert.equal(assets.length, 2, `${label} must have only the current APK and checksum asset links`);
  }
  assert.ok(downloads.includes(`下载宝宝今天 ${publishedVersion}`), 'README download label is stale');
  assert.ok(downloads.includes(`\`${publishedVersion} / code ${publishedCode}\``), 'README installed version is stale');
  const maintained = section(security, '支持范围').match(/Android `([^`]+)`（`versionCode=(\d+)`）/);
  assert.ok(maintained, 'SECURITY must declare the supported published build');
  assert.equal(maintained[1], publishedVersion, 'SECURITY maintained version is stale');
  assert.equal(Number(maintained[2]), publishedCode, 'SECURITY maintained code is stale');

  const stack = section(readme, '技术栈');
  for (const [label, dependency] of [
    ['Expo SDK', 'expo'], ['React Native', 'react-native'], ['React', 'react'],
    ['TypeScript', 'typescript'], ['Expo Router', 'expo-router'], ['Expo SQLite', 'expo-sqlite'],
    ['Jest', 'jest'], ['jest-expo', 'jest-expo'],
  ]) {
    const actual = lock.packages[`node_modules/${dependency}`]?.version;
    assert.ok(actual, `Missing locked dependency: ${dependency}`);
    const declared = stack.match(new RegExp(`${label} (\\d+\\.\\d+\\.\\d+)(?=\\s|$)`));
    assert.equal(declared?.[1], actual, `README ${label} differs from package-lock.json`);
  }
  return { source: `${sourceVersion}/code${sourceCode}`, published: `${publishedVersion}/code${publishedCode}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const names = { app: 'app.json', pkg: 'package.json', lock: 'package-lock.json', readme: 'README.md', security: 'SECURITY.md', releases: 'docs/RELEASE-NOTES.md' };
  const contents = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => {
    const value = await readFile(path.join(root, name), 'utf8');
    return [key, name.endsWith('.json') ? JSON.parse(value) : value];
  })));
  console.log('Release documentation consistency passed:', verifyReleaseBaseline(contents));
}
