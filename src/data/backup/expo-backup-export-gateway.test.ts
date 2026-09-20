import { Platform } from 'react-native';
import { ExpoBackupExportGateway } from './expo-backup-export-gateway';

const mockPick = jest.fn();
const mockPermission = jest.fn();
const mockCreate = jest.fn(() => ({ uri: 'content://created', name: 'backup-unique.zip' }));
jest.mock('@noble/hashes/sha2.js', () => ({ sha256: {} }));
jest.mock('@noble/hashes/utils.js', () => ({ bytesToHex: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unique-identifier' }));
jest.mock('expo-file-system/legacy', () => ({ StorageAccessFramework: { requestDirectoryPermissionsAsync: () => mockPermission() } }));
jest.mock('expo-file-system', () => ({ Directory: class {
  static pickDirectoryAsync(): Promise<unknown> { return mockPick(); }
  name = 'primary:Documents';
  uri: string;
  constructor(value: string) { this.uri = value; }
  createFile = mockCreate;
} }));

beforeEach(() => { jest.clearAllMocks(); jest.replaceProperty(Platform, 'OS', 'android'); });
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
