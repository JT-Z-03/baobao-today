import { Platform } from 'react-native';

const fs = jest.requireActual('node:fs');
const { tmpdir } = jest.requireActual('node:os');
const { join } = jest.requireActual('node:path');
const { fileURLToPath, pathToFileURL } = jest.requireActual('node:url');

const root = fs.mkdtempSync(join(tmpdir(), 'baobao-undo-'));
const mockDocumentUri = pathToFileURL(root).href;
const safetyPath = join(root, 'backup-safety');
const targetPath = join(safetyPath, 'last-restore.zip');
const pendingPath = join(safetyPath, 'pending-test.zip');
const targetUri = pathToFileURL(targetPath).href;
const pendingUri = pathToFileURL(pendingPath).href;
const oldBytes = Uint8Array.of(0, 127, 255);
const newBytes = Uint8Array.of(9, 0, 10, 11);
let mockRemovePendingBeforeRename = false;

function mockRename(from: string, to: string) {
  if (mockRemovePendingBeforeRename) fs.unlinkSync(fileURLToPath(from));
  fs.renameSync(fileURLToPath(from), fileURLToPath(to));
}

jest.mock('expo-file-system/legacy', () => ({
  moveAsync: async ({ from, to }: { from: string; to: string }) => mockRename(from, to),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: mockDocumentUri, document: mockDocumentUri },
  Directory: class {
    constructor(parent: string, name: string) { this.uri = parent + '/' + name; }
    uri: string;
    create() { /* The test creates the safety directory. */ }
  },
  File: class {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = typeof parent === 'string' ? parent : parent.uri + '/' + name;
    }
    get exists() { return mockFileExists(this.uri); }
    get parentDirectory() { return { uri: this.uri.slice(0, this.uri.lastIndexOf('/')) }; }
    async move(target: { uri: string }, options: { overwrite: boolean }) {
      // Expo SDK 57 Android resolves an overwrite target by deleting it before rename.
      if (options.overwrite && mockFileExists(target.uri)) mockDelete(target.uri);
      mockRename(this.uri, target.uri);
    }
  },
}));
function mockFileExists(uri: string) { return fs.existsSync(fileURLToPath(uri)); }
function mockDelete(uri: string) { fs.unlinkSync(fileURLToPath(uri)); }

// The file store creates its Directory objects as soon as the module is loaded.
const { ExpoBackupFileStore } = jest.requireActual<typeof import('./expo-backup-file-store')>('./expo-backup-file-store');
beforeAll(() => fs.mkdirSync(safetyPath));
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockRemovePendingBeforeRename = false;
  fs.writeFileSync(targetPath, oldBytes);
  fs.writeFileSync(pendingPath, newBytes);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(pendingPath, { force: true });
  fs.rmSync(targetPath, { force: true });
});
afterAll(() => {
  fs.rmdirSync(safetyPath);
  fs.rmdirSync(root);
});

test('a failed Android promotion keeps the previous undo archive readable on reopen', async () => {
  mockRemovePendingBeforeRename = true;
  await expect(new ExpoBackupFileStore().promoteSafetyArchive(pendingUri)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await new ExpoBackupFileStore().getSafetyArchiveUri()).toBe(targetUri);
  expect(new Uint8Array(fs.readFileSync(targetPath))).toEqual(oldBytes);
});

test('a successful Android promotion puts the complete replacement at the existing undo path', async () => {
  await new ExpoBackupFileStore().promoteSafetyArchive(pendingUri);
  expect(await new ExpoBackupFileStore().getSafetyArchiveUri()).toBe(targetUri);
  expect(new Uint8Array(fs.readFileSync(targetPath))).toEqual(newBytes);
  expect(fs.existsSync(pendingPath)).toBe(false);
});
