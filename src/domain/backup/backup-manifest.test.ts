import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupManifestError,
  buildBackupManifest,
  parseBackupManifest,
} from './backup-manifest';

const hash = 'a'.repeat(64);

function validManifest() {
  return buildBackupManifest({
    backupId: 'backup-123',
    createdAtMs: 1000,
    appVersion: '1.0.0',
    sourceSchemaVersion: 8,
    timezoneId: 'Asia/Shanghai',
    timezoneOffsetMinutes: -480,
    babyId: 'baby-1',
    recordCounts: { feeding: 1, poop: 1, pee: 1, sleep: 1, other: 1 },
    entries: [
      { path: 'baby.json', byteLength: 10, sha256: hash },
      { path: 'records.json', byteLength: 20, sha256: hash },
      { path: 'settings.json', byteLength: 30, sha256: hash },
      { path: 'photos/photo-1.jpg', byteLength: 40, sha256: hash },
    ],
  });
}

describe('backup manifest format', () => {
  test('builds deterministic format v1 counts and integrity metadata', () => {
    expect(validManifest()).toEqual(expect.objectContaining({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      totalRecordCount: 5,
      photoCount: 1,
      photoTotalBytes: 40,
    }));
    expect(parseBackupManifest(validManifest())).toEqual(validManifest());
  });

  test('rejects a backup from a newer format with a distinct code', () => {
    expect(() => parseBackupManifest({ ...validManifest(), formatVersion: 2 })).toThrow(
      expect.objectContaining({ code: 'unsupported-newer-version' }),
    );
  });

  test.each([
    ['foreign format', { format: 'ordinary-zip' }],
    ['duplicate entry', { entries: [...validManifest().entries, validManifest().entries[0]] }],
    ['wrong total', { totalRecordCount: 99 }],
    ['wrong photo count', { photoCount: 9 }],
    ['bad hash', { entries: [{ ...validManifest().entries[0], sha256: 'bad' }, ...validManifest().entries.slice(1)] }],
    ['unknown field', { notificationIdentifier: 'secret' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseBackupManifest({ ...validManifest(), ...patch })).toThrow(BackupManifestError);
  });
});
