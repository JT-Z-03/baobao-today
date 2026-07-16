import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipPassThrough,
  type UnzipFile,
} from 'fflate';

const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_COUNT = 10_003;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface ArchiveReader {
  readonly size: number;
  readAt(offset: number, length: number): Uint8Array;
  forEachChunk(chunkSize: number, visit: (chunk: Uint8Array, final: boolean) => void): void;
  close(): void;
}

export interface ArchiveWriter {
  write(bytes: Uint8Array): void;
  close(): void;
}

export interface ArchiveBinaryIo {
  openReader(uri: string): ArchiveReader;
  openWriter(uri: string): ArchiveWriter;
}

export interface ArchiveSourceEntry {
  path: string;
  sourceUri: string;
}

export interface InspectedArchiveEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  compression: 0 | 8;
  crc32: number;
  localHeaderOffset: number;
}

export interface ArchiveInspection {
  archiveSize: number;
  entries: InspectedArchiveEntry[];
  totalUncompressedSize: number;
}

export class ArchiveSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveSecurityError';
  }
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function allowedPath(path: string) {
  return path === 'manifest.json' || path === 'baby.json' || path === 'records.json'
    || path === 'settings.json' || /^photos\/[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$/.test(path);
}

function validatePath(path: string, seen: Set<string>) {
  const folded = path.toLowerCase();
  if (seen.has(folded)) throw new ArchiveSecurityError('备份归档包含重复或大小写冲突的路径');
  seen.add(folded);
  if (!allowedPath(path) || path.includes('..') || path.startsWith('/') || path.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')) {
    throw new ArchiveSecurityError('备份归档包含未知或不安全的路径');
  }
}

function maximumEntrySize(path: string) {
  return path.startsWith('photos/') ? MAX_PHOTO_BYTES : MAX_JSON_BYTES;
}

function findEocd(tail: Uint8Array) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (readU32(view, offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new ArchiveSecurityError('所选文件不是有效的ZIP归档');
}

function inspectCentralDirectory(reader: ArchiveReader): ArchiveInspection {
  if (reader.size < 22 || reader.size > MAX_ARCHIVE_BYTES) throw new ArchiveSecurityError('备份文件大小无效或过大');
  const tailSize = Math.min(reader.size, 65_557);
  const tail = reader.readAt(reader.size - tailSize, tailSize);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const eocdOffset = findEocd(tail);
  const disk = readU16(tailView, eocdOffset + 4);
  const centralDisk = readU16(tailView, eocdOffset + 6);
  const diskEntries = readU16(tailView, eocdOffset + 8);
  const entryCount = readU16(tailView, eocdOffset + 10);
  const centralSize = readU32(tailView, eocdOffset + 12);
  const centralOffset = readU32(tailView, eocdOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0
    || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ArchiveSecurityError('不支持多磁盘或ZIP64备份归档');
  }
  if (entryCount > MAX_ENTRY_COUNT || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
    || centralOffset + centralSize > reader.size) {
    throw new ArchiveSecurityError('备份归档条目数量或中央目录过大');
  }
  const central = reader.readAt(centralOffset, centralSize);
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries: InspectedArchiveEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let totalUncompressedSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > central.length || readU32(view, offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw new ArchiveSecurityError('备份归档中央目录结构损坏');
    }
    const madeBy = readU16(view, offset + 4);
    const flags = readU16(view, offset + 8);
    const compression = readU16(view, offset + 10);
    const crc32 = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const externalAttributes = readU32(view, offset + 38);
    const localHeaderOffset = readU32(view, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > central.length || nameLength === 0) throw new ArchiveSecurityError('备份归档条目结构损坏');
    const nameBytes = central.slice(offset + 46, offset + 46 + nameLength);
    if ([...nameBytes].some((byte) => byte > 0x7f)) throw new ArchiveSecurityError('备份归档条目必须使用ASCII路径');
    const path = String.fromCharCode(...nameBytes);
    validatePath(path, seen);
    if ((flags & 1) !== 0) throw new ArchiveSecurityError('不支持加密ZIP条目');
    if (compression !== 0 && compression !== 8) throw new ArchiveSecurityError('备份归档使用了不支持的压缩格式');
    const hostSystem = madeBy >> 8;
    const unixMode = externalAttributes >>> 16;
    if (hostSystem === 3 && (unixMode & 0xf000) === 0xa000) throw new ArchiveSecurityError('备份归档不得包含符号链接');
    if (uncompressedSize > maximumEntrySize(path)) throw new ArchiveSecurityError('备份归档包含过大的单个文件');
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)) {
      throw new ArchiveSecurityError('备份归档解压比过高');
    }
    if (localHeaderOffset + 30 > centralOffset) throw new ArchiveSecurityError('备份归档本地条目偏移无效');
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_TOTAL_EXTRACTED_BYTES) throw new ArchiveSecurityError('备份归档解压后总大小过大');
    entries.push({
      path,
      compressedSize,
      uncompressedSize,
      compression: compression as 0 | 8,
      crc32,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== central.length) throw new ArchiveSecurityError('备份归档中央目录长度不一致');
  return { archiveSize: reader.size, entries, totalUncompressedSize };
}

function exactTargets(inspection: ArchiveInspection, targets: ReadonlyMap<string, string>) {
  const expected = new Set(inspection.entries.map((entry) => entry.path));
  if (targets.size !== expected.size || [...targets.keys()].some((path) => !expected.has(path))) {
    throw new ArchiveSecurityError('归档解压目标与已校验条目不一致');
  }
}

export class FflateBackupArchiveGateway {
  private readonly chunkSize: number;

  constructor(
    private readonly io: ArchiveBinaryIo,
    options: { chunkSize?: number } = {},
  ) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  }

  async createArchive(outputUri: string, entries: readonly ArchiveSourceEntry[]) {
    const seen = new Set<string>();
    for (const entry of entries) validatePath(entry.path, seen);
    const writer = this.io.openWriter(outputUri);
    let archiveError: Error | null = null;
    let closed = false;
    const zip = new Zip((error, chunk, final) => {
      if (error) { archiveError = error; return; }
      writer.write(chunk);
      if (final) { writer.close(); closed = true; }
    });
    try {
      for (const entry of entries) {
        const source = this.io.openReader(entry.sourceUri);
        try {
          if (source.size > maximumEntrySize(entry.path)) throw new ArchiveSecurityError('备份源文件过大');
          const stream = new ZipPassThrough(entry.path);
          zip.add(stream);
          source.forEachChunk(this.chunkSize, (chunk, final) => stream.push(chunk, final));
        } finally {
          source.close();
        }
        if (archiveError) throw archiveError;
      }
      zip.end();
      if (archiveError) throw archiveError;
      if (!closed) throw new Error('ZIP归档未正常结束');
    } catch (error) {
      if (!closed) writer.close();
      throw error;
    }
  }

  async inspect(archiveUri: string) {
    const reader = this.io.openReader(archiveUri);
    try {
      return inspectCentralDirectory(reader);
    } finally {
      reader.close();
    }
  }

  async extract(archiveUri: string, targets: ReadonlyMap<string, string>) {
    const inspection = await this.inspect(archiveUri);
    exactTargets(inspection, targets);
    const expected = new Map(inspection.entries.map((entry) => [entry.path, entry]));
    const completed = new Set<string>();
    const openWriters = new Set<ArchiveWriter>();
    let callbackError: Error | null = null;
    let totalWritten = 0;
    const unzip = new Unzip((file: UnzipFile) => {
      try {
        const inspected = expected.get(file.name);
        const target = targets.get(file.name);
        if (!inspected || !target || completed.has(file.name)
          || file.compression !== inspected.compression
          || (file.originalSize !== undefined && file.originalSize !== inspected.uncompressedSize)
          || (file.size !== undefined && file.size !== inspected.compressedSize)) {
          throw new ArchiveSecurityError('解压条目与中央目录不一致');
        }
        const writer = this.io.openWriter(target);
        openWriters.add(writer);
        let entryWritten = 0;
        file.ondata = (error, chunk, final) => {
          if (error) { callbackError = error; return; }
          try {
            entryWritten += chunk.length;
            totalWritten += chunk.length;
            if (entryWritten > inspected.uncompressedSize || totalWritten > inspection.totalUncompressedSize) {
              throw new ArchiveSecurityError('归档实际解压大小超过声明值');
            }
            writer.write(chunk);
            if (final) {
              if (entryWritten !== inspected.uncompressedSize) throw new ArchiveSecurityError('归档条目长度不一致');
              writer.close();
              openWriters.delete(writer);
              completed.add(file.name);
            }
          } catch (caught) {
            callbackError = caught instanceof Error ? caught : new Error(String(caught));
          }
        };
        file.start();
      } catch (caught) {
        callbackError = caught instanceof Error ? caught : new Error(String(caught));
      }
    });
    unzip.register(UnzipInflate);
    const reader = this.io.openReader(archiveUri);
    try {
      reader.forEachChunk(this.chunkSize, (chunk, final) => {
        unzip.push(chunk, final);
        if (callbackError) throw callbackError;
      });
      if (callbackError) throw callbackError;
      if (completed.size !== inspection.entries.length) throw new ArchiveSecurityError('归档条目未完整解压');
    } finally {
      for (const writer of openWriters) writer.close();
      reader.close();
    }
    return inspection;
  }
}

export const BACKUP_ARCHIVE_LIMITS = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  entryCount: MAX_ENTRY_COUNT,
  jsonBytes: MAX_JSON_BYTES,
  photoBytes: MAX_PHOTO_BYTES,
  totalExtractedBytes: MAX_TOTAL_EXTRACTED_BYTES,
  compressionRatio: MAX_COMPRESSION_RATIO,
  chunkBytes: DEFAULT_CHUNK_SIZE,
} as const;
