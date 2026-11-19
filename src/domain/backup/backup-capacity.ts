// A bounded allocation budget, not a promise that every 100,000-record dataset fits.
// Format 1/2 readers predating this budget still reject records.json above 5 MiB.
export const BACKUP_CAPACITY_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  centralDirectoryBytes: 4 * 1024 * 1024,
  entryCount: 10_003,
  jsonBytes: 5 * 1024 * 1024,
  recordsJsonBytes: 16 * 1024 * 1024,
  photoBytes: 20 * 1024 * 1024,
  totalExtractedBytes: 512 * 1024 * 1024,
  compressionRatio: 100,
} as const;

export class BackupCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCapacityError';
  }
}

// Count without allocating a second full UTF-8 copy of records.json.
export function backupUtf8ByteLength(text: string) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else {
      // BMP characters and lone surrogates (UTF-8 replacement) both use 3 bytes.
      bytes += 3;
    }
  }
  return bytes;
}

export function maximumBackupEntryBytes(path: string) {
  if (path === 'records.json') return BACKUP_CAPACITY_LIMITS.recordsJsonBytes;
  return path.startsWith('photos/') ? BACKUP_CAPACITY_LIMITS.photoBytes : BACKUP_CAPACITY_LIMITS.jsonBytes;
}

export function assertBackupEntryCapacity(path: string, byteLength: number) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new BackupCapacityError('完整备份文件大小无效，当前资料未改变。');
  }
  if (byteLength <= maximumBackupEntryBytes(path)) return;
  if (path === 'records.json') {
    throw new BackupCapacityError('记录数据超过当前完整备份的16 MiB容量上限，当前资料未改变。');
  }
  const label = path.startsWith('photos/') ? '单张照片超过20 MiB' : '备份清单或设置超过5 MiB';
  throw new BackupCapacityError(`${label}容量上限，当前资料未改变。`);
}

export function inspectBackupCreationCapacity(entries: readonly { path: string; byteLength: number }[]) {
  if (entries.length === 0 || entries.length > BACKUP_CAPACITY_LIMITS.entryCount) {
    throw new BackupCapacityError('完整备份文件数量超过当前上限，当前资料未改变。');
  }
  let totalBytes = 0;
  let archiveBytes = 22; // End-of-central-directory record.
  let centralBytes = 0;
  for (const entry of entries) {
    assertBackupEntryCapacity(entry.path, entry.byteLength);
    const pathBytes = backupUtf8ByteLength(entry.path);
    totalBytes += entry.byteLength;
    // STORE entries need local/central headers, a data descriptor and two names.
    // 128 is a conservative bound for their fixed overhead (currently 92 bytes).
    archiveBytes += entry.byteLength + 128 + pathBytes * 2;
    centralBytes += 46 + pathBytes;
  }
  if (totalBytes > BACKUP_CAPACITY_LIMITS.totalExtractedBytes
    || archiveBytes > BACKUP_CAPACITY_LIMITS.archiveBytes) {
    throw new BackupCapacityError('完整备份总容量超过512 MiB上限，当前资料未改变。');
  }
  if (centralBytes > BACKUP_CAPACITY_LIMITS.centralDirectoryBytes) {
    throw new BackupCapacityError('完整备份目录大小超过当前上限，当前资料未改变。');
  }
  return { totalBytes, archiveBytes };
}
