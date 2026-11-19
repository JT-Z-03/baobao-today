import { BACKUP_JPEG_LIMITS, inspectBackupJpegHeader } from './backup-jpeg-budget';

// Minimal header only: native decoding remains the authority for the image body.
function header(width: number, height: number, marker = 0xc0) {
  return new Uint8Array([0xff, 0xd8, 0xff, marker, 0, 11, 8,
    height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
}

test.each([0xc0, 0xc1, 0xc2])('accepts a normal legacy JPEG frame 0x%s with metadata', (marker) => {
  const bytes = header(1600, 1200, marker);
  const withApp = new Uint8Array([...bytes.slice(0, 2), 0xff, 0xe1, 0, 4, 0, 0, ...bytes.slice(2)]);
  expect(inspectBackupJpegHeader(withApp)).toEqual({ width: 1600, height: 1200 });
});

test('accepts the exact pixel and edge budgets', () => {
  expect(inspectBackupJpegHeader(header(4096, 2048))).toEqual({ width: 4096, height: 2048 });
});

test.each([[4096, 2049], [65535, 1], [1, 65535], [65535, 65535], [0, 100], [100, 0]])(
  'rejects unsafe frame dimensions %s x %s before decoding', (width, height) => {
    expect(() => inspectBackupJpegHeader(header(width, height))).toThrow(/JPEG|像素/);
  },
);

test.each([
  new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1]),
  new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]),
  header(1600, 1200).slice(0, 14),
  new Uint8Array([...header(1600, 1200).slice(0, 15), ...header(65535, 65535).slice(2)]),
])('rejects missing, truncated, or conflicting frame metadata', (bytes) => {
  expect(() => inspectBackupJpegHeader(bytes)).toThrow(/JPEG/);
});

test('does not search beyond the bounded header even if a valid frame follows it', () => {
  const prefix = [0xff, 0xd8];
  while (prefix.length < BACKUP_JPEG_LIMITS.headerBytes) prefix.push(0xff, 0xfe, 0, 2);
  expect(() => inspectBackupJpegHeader(new Uint8Array([...prefix, ...header(1600, 1200).slice(2)]))).toThrow(/JPEG/);
});
