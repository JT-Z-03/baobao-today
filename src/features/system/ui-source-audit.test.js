/* global expect, test */

const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const sourceRoot = join(process.cwd(), 'src');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path));
}

test('product UI keeps colors, dialogs and template artifacts behind shared boundaries', () => {
  const violations = [];
  for (const path of sourceFiles(sourceRoot)) {
    const name = relative(sourceRoot, path).replaceAll('\\', '/');
    const source = readFileSync(path, 'utf8');
    if (name !== 'constants/theme.ts' && /#[0-9a-f]{3,8}\b|rgba?\(/i.test(source)) {
      violations.push(`${name}: hardcoded color`);
    }
    if (/\bAlert\.alert\b|import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*['"]react-native['"]/.test(source)) {
      violations.push(`${name}: system Alert`);
    }
    if (/animated-icon|hint-row|web-badge|external-link|ui\/collapsible/.test(source)) {
      violations.push(`${name}: Expo template UI reference`);
    }
  }
  expect(violations).toEqual([]);
});

test('Android native tab screens share one top safe-area boundary', () => {
  const rootLayout = readFileSync(join(sourceRoot, 'app', '_layout.tsx'), 'utf8');
  expect(rootLayout).toMatch(/<SafeAreaProvider\b/);

  for (const name of [
    'features/today/screens/today-screen.tsx',
    'features/records/screens/records-screen.tsx',
    'features/settings/screens/settings-screen.tsx',
  ]) {
    const source = readFileSync(join(sourceRoot, ...name.split('/')), 'utf8');
    expect(source).toMatch(/<NativeTabScreenContainer\b/);
  }
});
