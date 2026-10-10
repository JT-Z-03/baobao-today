// Expo 57's upward package.json search skips drive roots. A SUBST project lives
// at a drive root; include that final directory without copying the project.
const fs = require('node:fs');
const path = require('node:path');
const before = 'for (let dir = root; path_1.default.dirname(dir) !== dir; dir = path_1.default.dirname(dir)) {';
const after = "for (let dir = root; dir; dir = path_1.default.dirname(dir) === dir ? '' : path_1.default.dirname(dir)) {";
for (const [relative, variable] of [['commands/autolinkingOptions.js', 'root'], ['exports.js', 'cwd']]) {
  const file = path.join(process.cwd(), 'node_modules/expo-modules-autolinking/build', relative);
  const source = fs.readFileSync(file, 'utf8');
  const original = before.replace('dir = root;', `dir = ${variable};`);
  const replacement = after.replace('dir = root;', `dir = ${variable};`);
  if (source.includes(replacement)) continue;
  if (source.split(original).length !== 2) throw new Error(`Expo autolinking ${relative} changed; review the drive-root compatibility patch before building`);
  fs.writeFileSync(file, source.replace(original, replacement));
  console.log(`Expo autolinking ${relative} now includes the current project drive root.`);
}

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
      ? trim(normalize(to)) + normalized.slice(source.length) : item;
  });
}
`;
for (const relative of ['commands/reactNativeConfigCommand.js', 'commands/resolveCommand.js']) {
  const file = path.join(process.cwd(), 'node_modules/expo-modules-autolinking/build', relative);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('function bbtAliasJson(value)')) {
    fs.writeFileSync(file, source.slice(0, source.indexOf('function bbtAliasJson(value)')) + mapper.trimStart());
    continue;
  }
  if (source.split('console.log(JSON.stringify(').length !== 2) throw new Error(`Review Expo JSON output in ${relative}`);
  fs.writeFileSync(file, source.replace('console.log(JSON.stringify(', 'console.log(bbtAliasJson(') + mapper);
}
