import { ExpoBackupPhotoGateway } from './expo-backup-photo-gateway';
import { BACKUP_JPEG_LIMITS } from '@/domain/backup/backup-jpeg-budget';

const mockFiles = new Map<string, Uint8Array>();
const mockRead = jest.fn();
const mockBytes = jest.fn();
const mockClose = jest.fn();
const mockCopy = jest.fn();
const mockReleaseImage = jest.fn();
const mockReleaseContext = jest.fn();
const mockRender = jest.fn();
const mockManipulate = jest.fn();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'document' }, FileMode: { ReadOnly: 'read' },
  Directory: class { create = jest.fn(); },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.length ?? 0; }
    async bytes() { mockBytes(this.uri); return mockFiles.get(this.uri)!; }
    open() { return { readBytes: (count: number) => { mockRead(count); return mockFiles.get(this.uri)!.slice(0, count); }, close: mockClose }; }
    copy = mockCopy;
  },
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digest: async () => new Uint8Array(32).fill(0xab).buffer }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) } }));

// Synthetic 2x2 JPEG encoded with Windows GDI+; no user photo or file metadata.
const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8tNW1a+1/Vb3U9TvbjUdSvZnubq8u5WlmnldizyO7ElmZiSWJJJJJooooA//Z'), (value) => value.charCodeAt(0));
const hash = 'ab'.repeat(32);

beforeEach(() => {
  jest.clearAllMocks(); mockFiles.clear(); mockFiles.set('staged.jpg', jpeg);
  mockRender.mockResolvedValue({ release: mockReleaseImage });
  mockManipulate.mockReturnValue({ renderAsync: mockRender, release: mockReleaseContext });
});

test('a genuine normal JPEG reaches the decoder after the bounded header and hash checks', async () => {
  await new ExpoBackupPhotoGateway().validateStaged('staged.jpg', jpeg.length, hash);
  expect(mockRead).toHaveBeenCalledWith(jpeg.length);
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockManipulate).toHaveBeenCalledWith('staged.jpg');
  expect(mockReleaseImage).toHaveBeenCalledTimes(1);
  expect(mockReleaseContext).toHaveBeenCalledTimes(1);
});

test('an extreme SOF is rejected before full-file allocation, native decoding or restore copy', async () => {
  const huge = jpeg.slice();
  const frame = huge.findIndex((byte, index) => byte === 0xff && huge[index + 1] === 0xc0);
  huge[frame + 5] = 255; huge[frame + 6] = 255; huge[frame + 7] = 255; huge[frame + 8] = 255;
  mockFiles.set('staged.jpg', huge);
  await expect(new ExpoBackupPhotoGateway().restoreStaged('staged.jpg', 'session', 'record', huge.length, hash))
    .rejects.toThrow(/像素/);
  expect(mockBytes).not.toHaveBeenCalled(); expect(mockManipulate).not.toHaveBeenCalled(); expect(mockCopy).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('malformed content with JPEG start/end markers cannot reach native decode', async () => {
  mockFiles.set('staged.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await expect(new ExpoBackupPhotoGateway().validateStaged('staged.jpg', 4, hash)).rejects.toThrow(/JPEG/);
  expect(mockManipulate).not.toHaveBeenCalled(); expect(mockClose).toHaveBeenCalledTimes(1);
});

test('the header read never exceeds 1 MiB even for a large permitted file', async () => {
  mockFiles.set('staged.jpg', new Uint8Array(2 * BACKUP_JPEG_LIMITS.headerBytes));
  await expect(new ExpoBackupPhotoGateway().validateStaged('staged.jpg', 2 * BACKUP_JPEG_LIMITS.headerBytes, hash)).rejects.toThrow(/JPEG/);
  expect(mockRead).toHaveBeenCalledWith(BACKUP_JPEG_LIMITS.headerBytes);
  expect(mockBytes).not.toHaveBeenCalled(); expect(mockManipulate).not.toHaveBeenCalled();
});

test('hash mismatch still rejects before native decode', async () => {
  await expect(new ExpoBackupPhotoGateway().validateStaged('staged.jpg', jpeg.length, '00'.repeat(32))).rejects.toThrow(/完整性/);
  expect(mockManipulate).not.toHaveBeenCalled();
});

test('native decode failure still releases the image context', async () => {
  mockRender.mockRejectedValueOnce(new Error('invalid JPEG body'));
  await expect(new ExpoBackupPhotoGateway().validateStaged('staged.jpg', jpeg.length, hash)).rejects.toThrow('invalid JPEG body');
  expect(mockReleaseContext).toHaveBeenCalledTimes(1);
});
