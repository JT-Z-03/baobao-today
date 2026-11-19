import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runChecks } from './verify.mjs';
import { ESLint } from 'eslint';

test('checks run in order and stop at the first real child failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'baobao-verify-'));
  const output = path.join(root, 'order.txt');
  const command = (value, exitCode) => ({
    name: value,
    command: process.execPath,
    args: ['-e', 'require("node:fs").appendFileSync(process.argv[1],process.argv[2]);process.exit(Number(process.argv[3]))', output, value, String(exitCode)],
  });
  try {
    assert.equal(runChecks([command('a', 0), command('b', 7), command('c', 0)], { cwd: root, stdio: 'pipe' }), 7);
    assert.equal(await readFile(output, 'utf8'), 'ab');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a missing executable fails the gate', () => {
  assert.equal(runChecks([{ name: 'missing', command: '__baobao_missing_executable__', args: [] }], { stdio: 'pipe' }), 1);
});

test('architecture lint rejects reverse dependencies while allowing application ports', async () => {
  const eslint = new ESLint();
  const restricted = async (source, filePath) => {
    const [result] = await eslint.lintText(source, { filePath });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
  };
  assert.equal((await restricted("import { File } from 'expo-file-system'; export { File };", 'src/domain/architecture-gate.ts')).length, 1);
  assert.equal((await restricted("export { ThemedText } from '@/components/themed-text';", 'src/domain/architecture-gate.ts')).length, 1);
  assert.equal((await restricted("export { useTheme } from '../hooks/use-theme';", 'src/domain/architecture-gate.ts')).length, 1);
  assert.equal((await restricted("export { ExpoDraftAttachmentStore } from '@/data/workflow/expo-draft-attachment-store';", 'src/features/architecture-gate.ts')).length, 1);
  assert.equal((await restricted("export type { DraftAttachmentStore } from '@/application/ports/draft-attachment';", 'src/features/architecture-gate.ts')).length, 0);
});
