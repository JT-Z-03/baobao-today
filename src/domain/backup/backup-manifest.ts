import type {
  BackupIntegrityEntry,
  BackupManifest,
  BackupRecordCounts,
} from './backup-types';

export const BACKUP_FORMAT = 'baobao-today-backup' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;

export class BackupManifestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackupManifestError';
  }
}

type BuildInput = Omit<BackupManifest, 'format' | 'formatVersion' | 'totalRecordCount' | 'photoCount' | 'photoTotalBytes'>;

const countKeys: (keyof BackupRecordCounts)[] = ['feeding', 'poop', 'pee', 'sleep', 'other'];
const manifestKeys = [
  'format', 'formatVersion', 'backupId', 'createdAtMs', 'appVersion', 'sourceSchemaVersion',
  'timezoneId', 'timezoneOffsetMinutes', 'babyId', 'recordCounts', 'totalRecordCount',
  'photoCount', 'photoTotalBytes', 'entries',
] as const;

function error(code: string, message: string): never {
  throw new BackupManifestError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) {
    error('invalid-manifest', '备份清单包含不支持的字段');
  }
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) error('invalid-manifest', `${label}无效`);
  return value as number;
}

function parseCounts(raw: unknown): BackupRecordCounts {
  if (!isObject(raw)) error('invalid-manifest', '记录数量无效');
  exactKeys(raw, countKeys);
  return Object.fromEntries(countKeys.map((key) => [key, nonNegativeInteger(raw[key], `${key}数量`)])) as unknown as BackupRecordCounts;
}

function validPath(path: string) {
  return path === 'baby.json' || path === 'records.json' || path === 'settings.json'
    || /^photos\/[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$/.test(path);
}

function parseEntries(raw: unknown): BackupIntegrityEntry[] {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 10_003) error('invalid-manifest', '归档条目清单无效');
  const seen = new Set<string>();
  const entries = raw.map((item) => {
    if (!isObject(item)) error('invalid-manifest', '归档条目无效');
    exactKeys(item, ['path', 'byteLength', 'sha256']);
    if (typeof item.path !== 'string' || !validPath(item.path) || seen.has(item.path.toLowerCase())) {
      error('invalid-manifest', '归档条目路径无效或重复');
    }
    if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      error('invalid-manifest', '归档条目hash无效');
    }
    seen.add(item.path.toLowerCase());
    return { path: item.path, byteLength: nonNegativeInteger(item.byteLength, '归档条目大小'), sha256: item.sha256 };
  });
  for (const required of ['baby.json', 'records.json', 'settings.json']) {
    if (!seen.has(required)) error('invalid-manifest', `备份缺少${required}`);
  }
  return entries;
}

export function buildBackupManifest(input: BuildInput): BackupManifest {
  const totalRecordCount = countKeys.reduce((total, key) => total + input.recordCounts[key], 0);
  const photos = input.entries.filter((entry) => entry.path.startsWith('photos/'));
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    ...input,
    totalRecordCount,
    photoCount: photos.length,
    photoTotalBytes: photos.reduce((total, entry) => total + entry.byteLength, 0),
  };
}

export function parseBackupManifest(raw: unknown): BackupManifest {
  if (!isObject(raw)) error('invalid-backup', '所选文件不是有效的《宝宝今天》备份。');
  if (raw.format !== BACKUP_FORMAT) error('invalid-backup', '所选文件不是有效的《宝宝今天》备份。');
  if (typeof raw.formatVersion === 'number' && raw.formatVersion > BACKUP_FORMAT_VERSION) {
    error('unsupported-newer-version', '此备份由更新版本的《宝宝今天》创建，当前版本暂时无法恢复，请先升级App。');
  }
  exactKeys(raw, manifestKeys);
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) error('unsupported-version', '备份格式版本不受支持');
  const recordCounts = parseCounts(raw.recordCounts);
  const entries = parseEntries(raw.entries);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: typeof raw.backupId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw.backupId)
      ? raw.backupId : error('invalid-manifest', '备份ID无效'),
    createdAtMs: nonNegativeInteger(raw.createdAtMs, '备份创建时间'),
    appVersion: typeof raw.appVersion === 'string' && raw.appVersion.length > 0 && raw.appVersion.length <= 50
      ? raw.appVersion : error('invalid-manifest', 'App版本无效'),
    sourceSchemaVersion: nonNegativeInteger(raw.sourceSchemaVersion, '来源Schema版本'),
    timezoneId: typeof raw.timezoneId === 'string' && raw.timezoneId.length > 0 && raw.timezoneId.length <= 100
      ? raw.timezoneId : error('invalid-manifest', '来源时区无效'),
    timezoneOffsetMinutes: Number.isInteger(raw.timezoneOffsetMinutes)
      && (raw.timezoneOffsetMinutes as number) >= -840 && (raw.timezoneOffsetMinutes as number) <= 840
      ? raw.timezoneOffsetMinutes as number : error('invalid-manifest', '来源时区偏移无效'),
    babyId: typeof raw.babyId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw.babyId)
      ? raw.babyId : error('invalid-manifest', '宝宝ID无效'),
    recordCounts,
    totalRecordCount: nonNegativeInteger(raw.totalRecordCount, '记录总数'),
    photoCount: nonNegativeInteger(raw.photoCount, '照片数量'),
    photoTotalBytes: nonNegativeInteger(raw.photoTotalBytes, '照片总大小'),
    entries,
  };
  const expectedTotal = countKeys.reduce((total, key) => total + recordCounts[key], 0);
  const photos = entries.filter((entry) => entry.path.startsWith('photos/'));
  if (manifest.totalRecordCount !== expectedTotal || manifest.photoCount !== photos.length
    || manifest.photoTotalBytes !== photos.reduce((total, entry) => total + entry.byteLength, 0)) {
    error('invalid-manifest', '备份清单统计不一致');
  }
  return manifest;
}

export function serializeBackupJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
