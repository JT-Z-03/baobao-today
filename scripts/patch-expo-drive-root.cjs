/* global __dirname */
// Reviewed against the official expo-modules-autolinking 57.0.18 npm archive.
// Its upward package search skips drive roots, and JSON output uses physical
// realpaths instead of the SUBST alias. See the fixture's provenance.json.
// On dependency updates, review both behaviours before changing these hashes
// or retiring the patch. Unknown versions/content must never be patched.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const VERSION = '57.0.18';
const targets = [
  {
    relative: 'commands/autolinkingOptions.js', variable: 'root',
    original: '569debd22698218c0543a69ec7b0c3c76207d70bb72dbd0c7414ddd2820a98cd',
    patched: 'f6185b864d432743e211fa439e0dcf55cd3ea9359738fdb053079a0f3e25a5d8',
  },
  {
    relative: 'exports.js', variable: 'cwd',
    original: '7d966e4c4933b45779f2f4e1db062da6bf5828c9a958ee954489a070107b3b47',
    patched: 'f0e67b811362e9d418ab702374372d4a1a4bbccda8b77e763c50087957d30c8a',
  },
  {
    relative: 'commands/reactNativeConfigCommand.js',
    original: 'd1ee09934b9c64ef84538c9b86fbfa035f41fbec572fa4201df97380c7d80397',
    legacy: '86e742a24e70d9d7e2ea65ca63cac66c2d65b47f28bb751f40cf5e75ba9e8416',
    patched: '5380e7cd5b1e4884bf2b63b6b076be1d6d8d1fd6eb14a2c6ff275804274cb72a',
  },
  {
    relative: 'commands/resolveCommand.js',
    original: '1aeb875da813f1c19be803ab89c20a79cfde78b0add758997f9e1bb741b5b186',
    legacy: 'f9a49e7bbf22820e344b1a9269cc121cd296135075a3bd44ec5ce9da686ecd38',
    patched: 'f88f0c61dd5af74e5d01a400bba3159023f685014ebee50548b35469aed970a7',
  },
];

// Expo resolves packages through realpath and otherwise mixes D: and the SUBST
// drive in one Gradle project. Normalize only paths inside this exact project.
const mapper = `
function bbtAliasJson(value) {
  const from = process.env.BBT_NATIVE_SOURCE_ROOT;
  const to = process.env.BBT_NATIVE_ALIAS_ROOT;
  return JSON.stringify(value, (_key, item) => {
    if (!from || !to || typeof item !== 'string') return item;
    const normalize = (text) => text.split(String.fromCharCode(92)).join('/');
    const trim = (text) => text.endsWith('/') ? text.slice(0, -1) : text;
    const normalized = normalize(item);
    const source = trim(normalize(from));
    return normalized.toLowerCase() === source.toLowerCase() || normalized.toLowerCase().startsWith(source.toLowerCase() + '/')
      ? trim(normalize(to)) + (normalized.slice(source.length) || '/') : item;
  });
}
`;
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('Reviewed Expo drive-root patch target was not found exactly once. No file was written.');
  }
  return source.replace(before, after);
}

function applyPatch(projectRoot = path.resolve(__dirname, '..')) {
  const packageRoot = path.join(projectRoot, 'node_modules/expo-modules-autolinking');
  const installed = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (installed.name !== 'expo-modules-autolinking' || installed.version !== VERSION) {
    throw new Error(`expo-modules-autolinking version ${installed.version} is not the reviewed ${VERSION}; review the drive-root patch before building. No file was written.`);
  }
  // Preflight every input AND computed output before the first write. If an
  // interrupted write leaves a mixture of known files, a rerun can complete it.
  const pending = targets.flatMap((target) => {
    const file = path.join(packageRoot, 'build', target.relative);
    const bytes = fs.readFileSync(file);
    const hash = sha256(bytes);
    if (hash === target.patched) return [];
    if (hash !== target.original && hash !== target.legacy) {
      throw new Error(`expo-modules-autolinking ${VERSION} ${target.relative} SHA-256 mismatch (${hash}); review source drift before building. No file was written.`);
    }
    const source = bytes.toString('utf8');
    let patched;
    if (target.variable) {
      patched = replaceOnce(source,
        `for (let dir = ${target.variable}; path_1.default.dirname(dir) !== dir; dir = path_1.default.dirname(dir)) {`,
        `for (let dir = ${target.variable}; dir; dir = path_1.default.dirname(dir) === dir ? '' : path_1.default.dirname(dir)) {`);
    } else if (hash === target.legacy) {
      // The former reviewed patch emitted R: for the exact root, which is a
      // drive-relative path on Windows. Migrate only its complete known bytes.
      patched = replaceOnce(source,
        '? trim(normalize(to)) + normalized.slice(source.length) : item;',
        "? trim(normalize(to)) + (normalized.slice(source.length) || '/') : item;");
    } else {
      patched = replaceOnce(source, 'console.log(JSON.stringify(', 'console.log(bbtAliasJson(') + mapper;
    }
    if (sha256(patched) !== target.patched) {
      throw new Error(`Expo drive-root patch output SHA-256 mismatch for ${target.relative}. No file was written.`);
    }
    return [{ file, patched }];
  });
  for (const { file, patched } of pending) fs.writeFileSync(file, patched);
  return pending.length ? 'patched' : 'already patched';
}

module.exports = { applyPatch };

if (require.main === module) {
  try {
    console.log(`expo-modules-autolinking ${VERSION} drive-root compatibility: ${applyPatch()}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
