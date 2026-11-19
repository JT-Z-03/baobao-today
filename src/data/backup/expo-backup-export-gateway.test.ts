import { Platform } from 'react-native';
import { ExpoBackupExportGateway } from './expo-backup-export-gateway';

const { createHash } = jest.requireActual('node:crypto');

const mockPick = jest.fn();
const mockPermission = jest.fn();
const mockCreate = jest.fn(() => ({ uri: 'content://created', name: 'backup-unique.zip' }));
const mockOpen = jest.fn();
const mockNativeFingerprint = jest.fn();
const mockOptionalModule = jest.fn();
jest.mock('expo-modules-core', () => ({ ...jest.requireActual('expo-modules-core'), requireOptionalNativeModule: (...args: unknown[]) => mockOptionalModule(...args) }));
jest.mock('@noble/hashes/sha2.js', () => ({ sha256: { create: () => jest.requireActual('node:crypto').createHash('sha256') } }));
jest.mock('@noble/hashes/utils.js', () => ({ bytesToHex: (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unique-identifier' }));
jest.mock('expo-file-system/legacy', () => ({ StorageAccessFramework: { requestDirectoryPermissionsAsync: () => mockPermission() } }));
jest.mock('expo-file-system', () => ({ File: class { open = mockOpen; }, FileMode: { ReadOnly: 'r' }, Directory: class {
  static pickDirectoryAsync(): Promise<unknown> { return mockPick(); }
  name = 'primary:Documents';
  uri: string;
  constructor(value: string) { this.uri = value; }
  createFile = mockCreate;
} }));

beforeEach(() => {
  jest.clearAllMocks(); jest.replaceProperty(Platform, 'OS', 'android');
  mockOptionalModule.mockReturnValue({ fingerprint: mockNativeFingerprint });
});
afterEach(() => jest.restoreAllMocks());

test('a canceled modern picker does not prompt again or create a file', async () => {
  mockPick.mockRejectedValue({ code: 'ERR_PICKER_CANCELLED' });
  expect(await new ExpoBackupExportGateway().chooseTarget('backup.zip')).toBeNull();
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});

test('a recreated Android activity uses the system SAF chooser and its explicit permission', async () => {
  mockPick.mockRejectedValue(new Error('Attempting to launch an unregistered ActivityResultLauncher'));
  mockPermission.mockResolvedValue({ granted: true, directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADocuments' });
  expect(await new ExpoBackupExportGateway().chooseTarget('backup.zip')).toEqual({
    uri: 'content://created', filename: 'backup-unique.zip', location: 'Documents',
  });
  expect(mockPermission).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('declining the fallback chooser is cancellation without creating a file', async () => {
  mockPick.mockRejectedValue(new Error('unregistered ActivityResultLauncher'));
  mockPermission.mockResolvedValue({ granted: false });
  expect(await new ExpoBackupExportGateway().chooseTarget('backup.zip')).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
});

test('other picker failures do not silently open another permission flow', async () => {
  mockPick.mockRejectedValue(new Error('provider unavailable'));
  await expect(new ExpoBackupExportGateway().chooseTarget('backup.zip')).rejects.toThrow('暂时无法打开保存位置');
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});

describe('fingerprint integrity and native handoff', () => {
  const bytes = Uint8Array.from([0, 128, 255, 17, 10]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  function handle(size = bytes.length) {
    const value = { size, close: jest.fn(), readBytes: jest.fn().mockReturnValueOnce(bytes).mockReturnValue(new Uint8Array()) };
    mockOpen.mockReturnValue(value);
    return value;
  }

  test('Android closes the size handle before handing the same URI to the native stream', async () => {
    const file = handle();
    mockNativeFingerprint.mockImplementation(async () => {
      expect(file.close).toHaveBeenCalledTimes(1);
      return { byteLength: bytes.length, sha256 };
    });
    expect(await new ExpoBackupExportGateway().fingerprint('content://fictional/backup')).toEqual({ byteLength: 5, sha256 });
    expect(mockOptionalModule).toHaveBeenCalledWith('BackupFingerprint');
    expect(mockNativeFingerprint).toHaveBeenCalledWith('content://fictional/backup', 5);
    expect(file.readBytes).not.toHaveBeenCalled();
  });

  test.each([0, -1, 512 * 1024 * 1024 + 1, NaN, 1.5])('rejects invalid size %s before native reads', async (size) => {
    const file = handle(size);
    await expect(new ExpoBackupExportGateway().fingerprint('file:///fictional.zip')).rejects.toThrow('备份文件大小无效');
    expect(mockNativeFingerprint).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledTimes(1);
  });

  test('native read/grant failure propagates without hashing another copy', async () => {
    const file = handle();
    mockNativeFingerprint.mockRejectedValue(new Error('permission revoked'));
    await expect(new ExpoBackupExportGateway().fingerprint('content://fictional/backup')).rejects.toThrow('permission revoked');
    expect(file.readBytes).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledTimes(1);
  });

  test.each([{ byteLength: 4, sha256 }, { byteLength: 5, sha256: 'bad' }])('rejects a malformed native result', async (result) => {
    handle(); mockNativeFingerprint.mockResolvedValue(result);
    await expect(new ExpoBackupExportGateway().fingerprint('file:///fictional.zip')).rejects.toThrow('备份文件完整性校验失败');
  });

  test.each(['ios', 'missing-native'])('retains streaming SHA256 for %s', async (mode) => {
    if (mode === 'ios') jest.replaceProperty(Platform, 'OS', 'ios');
    else mockOptionalModule.mockReturnValue(null);
    const file = handle();
    expect(await new ExpoBackupExportGateway().fingerprint('file:///fictional.zip')).toEqual({ byteLength: 5, sha256 });
    expect(mockNativeFingerprint).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledTimes(1);
  });

  test('legacy streaming still rejects an interrupted read and closes the handle', async () => {
    mockOptionalModule.mockReturnValue(null);
    const file = handle(6);
    await expect(new ExpoBackupExportGateway().fingerprint('file:///fictional.zip')).rejects.toThrow('备份文件读取中断');
    expect(file.close).toHaveBeenCalledTimes(1);
  });
});
