import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipPassThrough,
  type UnzipFile,
} from 'fflate';
import { emitBackupProgress, type BackupProgressObserver } from '@/application/ports/backup';
import {
  BACKUP_CAPACITY_LIMITS,
  inspectBackupCreationCapacity,
  maximumBackupEntryBytes,
} from '@/domain/backup/backup-capacity';

const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const MAX_ARCHIVE_BYTES = BACKUP_CAPACITY_LIMITS.archiveBytes;
const MAX_CENTRAL_DIRECTORY_BYTES = BACKUP_CAPACITY_LIMITS.centralDirectoryBytes;
const MAX_ENTRY_COUNT = BACKUP_CAPACITY_LIMITS.entryCount;
const MAX_TOTAL_EXTRACTED_BYTES = BACKUP_CAPACITY_LIMITS.totalExtractedBytes;
const MAX_COMPRESSION_RATIO = BACKUP_CAPACITY_LIMITS.compressionRatio;
const DEFAULT_CHUNK_SIZE = 64 * 1024;
const YIELD_BYTES = 256 * 1024;
const YIELD_INTERVAL_MS = 8;
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A macrotask gives rendering/input a turn; Promise.resolve alone does not.
// One synchronous codec push remains bounded by the input chunk, not by wall time.
class ArchiveWorkBudget {
  private bytes = 0;
  private startedAt = Date.now();
  async checkpoint(bytes: number, force = false) {
    this.bytes += bytes;
    if (!force && this.bytes < YIELD_BYTES && Date.now() - this.startedAt < YIELD_INTERVAL_MS) return;
    await yieldToUi();
    this.bytes = 0;
    this.startedAt = Date.now();
  }
}

async function readChunks(reader: ArchiveReader, chunkSize: number,
  visit: (chunk: Uint8Array, final: boolean) => void, budget: ArchiveWorkBudget) {
  if (reader.size === 0) { visit(new Uint8Array(), true); return; }
  let offset = 0;
  while (offset < reader.size) {
    const requested = Math.min(chunkSize, reader.size - offset);
    const chunk = reader.readAt(offset, requested);
    if (chunk.length === 0 || chunk.length > requested) throw new Error('备份文件读取中断');
    offset += chunk.length;
    visit(chunk, offset === reader.size);
    await budget.checkpoint(chunk.length);
  }
}

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

function findEocd(tail: Uint8Array) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (readU32(view, offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new ArchiveSecurityError('所选文件不是有效的ZIP归档');
}

async function inspectCentralDirectory(reader: ArchiveReader, observer?: BackupProgressObserver): Promise<ArchiveInspection> {
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
  const budget = new ArchiveWorkBudget();
  emitBackupProgress(observer, { stage: 'inspect', completed: 0, total: entryCount, unit: 'files' });
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
    if (uncompressedSize > maximumBackupEntryBytes(path)) throw new ArchiveSecurityError('备份归档包含过大的单个文件');
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
    if ((index + 1) % 64 === 0 || index + 1 === entryCount) {
      emitBackupProgress(observer, { stage: 'inspect', completed: index + 1, total: entryCount, unit: 'files' });
      await budget.checkpoint(0, true);
    }
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
    if (!Number.isSafeInteger(this.chunkSize) || this.chunkSize < 1 || this.chunkSize > DEFAULT_CHUNK_SIZE) {
      throw new Error('归档读取块大小必须在1到65536字节之间');
    }
  }

  async createArchive(outputUri: string, entries: readonly ArchiveSourceEntry[], observer?: BackupProgressObserver) {
    const seen = new Set<string>();
    for (const entry of entries) validatePath(entry.path, seen);
    inspectBackupCreationCapacity(entries.map((entry) => ({ path: entry.path, byteLength: 0 })));
    const sourceSizes = new Map<string, number>();
    const budget = new ArchiveWorkBudget();
    await budget.checkpoint(0, true);
    for (const entry of entries) {
      const reader = this.io.openReader(entry.sourceUri);
      try { sourceSizes.set(entry.path, reader.size); }
      finally { reader.close(); }
      if (sourceSizes.size % 64 === 0) await budget.checkpoint(0, true);
    }
    inspectBackupCreationCapacity(entries.map((entry) => ({ path: entry.path, byteLength: sourceSizes.get(entry.path)! })));
    const writer = this.io.openWriter(outputUri);
    const total = [...sourceSizes.values()].reduce((sum, size) => sum + size, 0);
    let completed = 0;
    emitBackupProgress(observer, { stage: 'archive', completed, total, unit: 'bytes' });
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
          if (source.size !== sourceSizes.get(entry.path)) throw new ArchiveSecurityError('备份源文件大小发生变化，请重试');
          const stream = new ZipPassThrough(entry.path);
          zip.add(stream);
          await readChunks(source, this.chunkSize, (chunk, final) => {
            stream.push(chunk, final);
            if (archiveError) throw archiveError;
            completed += chunk.length;
            emitBackupProgress(observer, { stage: 'archive', completed, total, unit: 'bytes' });
          }, budget);
        } finally {
          source.close();
        }
        if (archiveError) throw archiveError;
      }
      zip.end();
      if (archiveError) throw archiveError;
      if (!closed) throw new Error('ZIP归档未正常结束');
    } catch (error) {
      if (!closed) {
        try { writer.close(); } catch { /* Preserve the archive failure. */ }
      }
      throw error;
    }
  }

  async inspect(archiveUri: string, observer?: BackupProgressObserver) {
    const reader = this.io.openReader(archiveUri);
    try {
      return await inspectCentralDirectory(reader, observer);
    } finally {
      reader.close();
    }
  }

  async extract(archiveUri: string, targets: ReadonlyMap<string, string>, observer?: BackupProgressObserver) {
    const inspection = await this.inspect(archiveUri, observer);
    exactTargets(inspection, targets);
    const expected = new Map(inspection.entries.map((entry) => [entry.path, entry]));
    const completed = new Set<string>();
    const openWriters = new Set<ArchiveWriter>();
    let callbackError: Error | null = null;
    let totalWritten = 0;
    const budget = new ArchiveWorkBudget();
    emitBackupProgress(observer, { stage: 'extract', completed: 0, total: inspection.totalUncompressedSize, unit: 'bytes' });
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
    let failed = false;
    try {
      await readChunks(reader, this.chunkSize, (chunk, final) => {
        unzip.push(chunk, final);
        if (callbackError) throw callbackError;
        emitBackupProgress(observer, { stage: 'extract', completed: totalWritten, total: inspection.totalUncompressedSize, unit: 'bytes' });
      }, budget);
      if (callbackError) throw callbackError;
      if (completed.size !== inspection.entries.length) throw new ArchiveSecurityError('归档条目未完整解压');
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      let closeError: unknown;
      for (const resource of [...openWriters, reader]) {
        try { resource.close(); } catch (error) { closeError ??= error; }
      }
      if (!failed && closeError) throw closeError;
    }
    return inspection;
  }
}

export const BACKUP_ARCHIVE_LIMITS = {
  ...BACKUP_CAPACITY_LIMITS,
  chunkBytes: DEFAULT_CHUNK_SIZE,
} as const;
