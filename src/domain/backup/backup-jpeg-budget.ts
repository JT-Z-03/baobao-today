// App-managed photos are normalized to a 1600px long edge. Allow older normal
// JPEGs some headroom, while bounding one 8-bit RGBA surface to 32 MiB. Decoder
// scratch space and other copies are additional; this is not a process-memory cap.
export const BACKUP_JPEG_LIMITS = {
  headerBytes: 1024 * 1024,
  maxEdge: 4096,
  maxPixels: 8 * 1024 * 1024,
} as const;

function invalid(): never {
  throw new Error('备份照片JPEG头部无效、损坏或超出读取预算');
}

/** Reads only marker metadata through the first scan; never decodes pixel data. */
export function inspectBackupJpegHeader(input: Uint8Array): { width: number; height: number } {
  const bytes = input.subarray(0, BACKUP_JPEG_LIMITS.headerBytes);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  let components = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (marker === 1) continue; // TEM is the only other stand-alone marker.
    if (offset + 2 > bytes.length) invalid();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) invalid();
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (dimensions || length < 8) invalid();
      const precision = bytes[offset + 2];
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      components = bytes[offset + 7];
      if (precision !== 8 || components < 1 || components > 4 || length !== 8 + 3 * components || !width || !height) invalid();
      if (width > BACKUP_JPEG_LIMITS.maxEdge || height > BACKUP_JPEG_LIMITS.maxEdge
        || width * height > BACKUP_JPEG_LIMITS.maxPixels) {
        throw new Error('备份照片像素尺寸超出安全解码上限');
      }
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      const scanComponents = bytes[offset + 2];
      if (!dimensions || scanComponents < 1 || scanComponents > components || length !== 6 + 2 * scanComponents) invalid();
      return dimensions;
    }
    offset += length;
  }
  return invalid();
}
