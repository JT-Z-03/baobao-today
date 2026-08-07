import { buildBackupManifest, serializeBackupJson } from '@/domain/backup/backup-manifest';
import type { BackupData } from '@/domain/backup/backup-types';

import { createBackupValidationService } from './backup-validation-service';

const hash = 'a'.repeat(64);
const data: BackupData = {
  baby: { id: 'baby-1', name: '小宝', birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 1 },
  records: [{
    id: 'poop-1', client_request_id: 'request-1', create_payload_hash: 'b'.repeat(64), type: 'poop',
    event_time_ms: 1, record_date: '2026-07-10', sort_time_ms: 1, created_at_ms: 1, updated_at_ms: 1,
    note: null, feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null, left_duration_min: null, right_duration_min: null,
    poop_color: 'yellow', poop_texture: null, poop_amount: null, photo_backup_entry: 'photos/photo-1.jpg',
    photo_sha256: hash, pee_color: null, pee_amount: null, sleep_start_ms: null, sleep_end_ms: null,
    sleep_status: null, other_title: null,
  }],
  settings: { theme_mode: 'dark', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 120 },
};

function setup(overrides: {
  manifestPatch?: Record<string, unknown>;
  textHash?: string;
  records?: unknown;
} = {}) {
  const texts = {
    'baby.json': serializeBackupJson(data.baby),
    'records.json': serializeBackupJson(overrides.records ?? data.records),
    'settings.json': serializeBackupJson(data.settings),
  };
  const entries = Object.entries(texts).map(([path, content]) => ({
    path, byteLength: new TextEncoder().encode(content).length, sha256: hash,
  })).concat([{ path: 'photos/photo-1.jpg', byteLength: 6, sha256: hash }]);
  const manifest = { ...buildBackupManifest({
    backupId: 'backup-1', createdAtMs: 1, appVersion: '1.0.0', sourceSchemaVersion: 8,
    timezoneId: 'Asia/Shanghai', timezoneOffsetMinutes: -480, babyId: 'baby-1',
    recordCounts: { feeding: 0, poop: 1, pee: 0, sleep: 0, other: 0 }, entries,
  }), ...overrides.manifestPatch };
  const workspace = {
    id: 'restore-1', archiveUri: 'private/source.zip',
    targetUri: jest.fn((path: string) => `private/${path}`),
    readText: jest.fn(async (path: keyof typeof texts | 'manifest.json') =>
      path === 'manifest.json' ? serializeBackupJson(manifest) : texts[path]),
    cleanup: jest.fn(async () => undefined),
  };
  const archiveGateway = {
    inspect: jest.fn(async () => ({ archiveSize: 100, totalUncompressedSize: 100,
      entries: [{ path: 'manifest.json', compressedSize: 1, uncompressedSize: 1 },
        ...entries.map((entry) => ({ path: entry.path, compressedSize: entry.byteLength, uncompressedSize: entry.byteLength }))] })),
    extract: jest.fn(async (_uri: string, targets: ReadonlyMap<string, string>) => ({
      archiveSize: 100, totalUncompressedSize: 100,
      entries: [...targets.keys()].map((path) => ({ path, compressedSize: 1, uncompressedSize: 1 })),
    })),
    createArchive: jest.fn(),
  };
  const photoGateway = {
    inspectManaged: jest.fn(), restoreStaged: jest.fn(), deleteManaged: jest.fn(),
    validateStaged: jest.fn(async () => undefined),
  };
  const service = createBackupValidationService({
    fileStore: {
      createRestoreWorkspace: jest.fn(async () => workspace),
      ensureAvailableSpace: jest.fn(async () => undefined),
    } as never,
    archiveGateway,
    photoGateway,
    hashGateway: { sha256Text: jest.fn(async () => overrides.textHash ?? hash) },
  });
  return { service, workspace, archiveGateway, photoGateway };
}

function setupArchive(formatVersion: 1 | 2) {
  const records = formatVersion === 1
    ? data.records.map(({ breast_milk_amount_ml: _breastMilkAmountMl, ...record }) => record)
    : data.records;
  return setup({ manifestPatch: { formatVersion }, records });
}

describe('BackupValidationService', () => {
  test('validates archive structure, hashes, business data, photos, and returns a restore preview', async () => {
    const { service, photoGateway } = setup();
    const prepared = await service.prepare('picked.zip', 'restore-1');
    expect(prepared.data).toEqual(data);
    expect(prepared.summary).toMatchObject({ babyName: '小宝', poopCount: 1, photoCount: 1, themeMode: 'dark' });
    expect(prepared.photoUris.get('photos/photo-1.jpg')).toBe('private/photos/photo-1.jpg');
    expect(photoGateway.validateStaged).toHaveBeenCalledWith('private/photos/photo-1.jpg', 6, hash);
  });

  test.each([1, 2] as const)('prepares format version %s with current normalized data', async (formatVersion) => {
    const { service } = setupArchive(formatVersion);
    const prepared = await service.prepare('backup.zip', 'restore-session');
    expect(prepared.manifest.formatVersion).toBe(formatVersion);
    expect(prepared.data.records[0]).toHaveProperty('breast_milk_amount_ml');
  });

  test('cleans staging and rejects a newer format before exposing preview', async () => {
    const { service, workspace } = setup({ manifestPatch: { formatVersion: 3 } });
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('cleans staging and rejects JSON hash mismatch without touching photos', async () => {
    const { service, workspace, photoGateway } = setup({ textHash: 'f'.repeat(64) });
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow(/完整性/);
    expect(photoGateway.validateStaged).not.toHaveBeenCalled();
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('rejects insufficient extraction space before archive extraction', async () => {
    const { workspace, archiveGateway, photoGateway } = setup();
    const fileStore = {
      createRestoreWorkspace: jest.fn(async () => workspace),
      ensureAvailableSpace: jest.fn(async () => { throw new Error('insufficient space'); }),
    };
    const service = createBackupValidationService({
      fileStore: fileStore as never,
      archiveGateway,
      photoGateway,
      hashGateway: { sha256Text: jest.fn(async () => hash) },
    });
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow('insufficient space');
    expect(archiveGateway.extract).not.toHaveBeenCalled();
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('rejects an archive without manifest before parsing business data', async () => {
    const { service, workspace, archiveGateway } = setup();
    (archiveGateway.inspect as jest.Mock).mockResolvedValueOnce({
      archiveSize: 100,
      totalUncompressedSize: 10,
      entries: [{ path: 'baby.json', compressedSize: 1, uncompressedSize: 1 }],
    });
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow(/manifest\.json/);
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('rejects a non-app manifest and keeps staged data disposable', async () => {
    const { service, workspace } = setup({ manifestPatch: { format: 'not-this-app' } });
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow();
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('rejects manifest byte-length mismatch before JSON import', async () => {
    const { service, workspace, archiveGateway } = setup();
    const inspected = await archiveGateway.inspect();
    inspected.entries.find((entry) => entry.path === 'records.json')!.uncompressedSize += 1;
    (archiveGateway.inspect as jest.Mock).mockResolvedValueOnce(inspected);
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow(/字节数/);
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('rejects a photo that fails real image validation', async () => {
    const { service, workspace, photoGateway } = setup();
    photoGateway.validateStaged.mockRejectedValueOnce(new Error('fake jpeg'));
    await expect(service.prepare('picked.zip', 'restore-1')).rejects.toThrow('fake jpeg');
    expect(workspace.cleanup).toHaveBeenCalled();
  });
});
