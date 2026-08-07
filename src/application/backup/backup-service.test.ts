import type { BackupSnapshot } from '@/application/ports/backup';

import { createBackupService } from './backup-service';

const snapshot: BackupSnapshot = {
  sourceSchemaVersion: 8,
  baby: { id: 'baby-1', name: '小宝', birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 1 },
  records: [{
    id: 'poop-1', client_request_id: 'request-1', create_payload_hash: 'a'.repeat(64), type: 'poop',
    event_time_ms: 1, record_date: '2026-07-10', sort_time_ms: 1, created_at_ms: 1, updated_at_ms: 1,
    note: null, feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null, left_duration_min: null, right_duration_min: null,
    poop_color: 'yellow', poop_texture: null, poop_amount: null, source_photo_path: 'poop-photos/original.jpg',
    pee_color: null, pee_amount: null, sleep_start_ms: null, sleep_end_ms: null, sleep_status: null, other_title: null,
  }],
  settings: { theme_mode: 'dark', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 120 },
};

function setup(customSnapshot: BackupSnapshot = snapshot) {
  const workspace = {
    id: 'backup-1', filename: 'baobao-today-backup-20260712-120000-000.zip', archiveUri: 'cache/backup.zip',
    writeJson: jest.fn(async (path: string, content: string) => ({
      path, content, uri: `stage/${path}`, byteLength: new TextEncoder().encode(content).length, sha256: 'b'.repeat(64),
    })),
    cleanup: jest.fn(async () => undefined),
  };
  const archiveGateway = { createArchive: jest.fn(async () => undefined), inspect: jest.fn(), extract: jest.fn() };
  const shareGateway = { isAvailable: jest.fn(async () => true), share: jest.fn(async () => undefined) };
  const validationService = { prepare: jest.fn(async () => ({ dispose: jest.fn(async () => undefined) })) };
  const coordinator = { busy: false, runExclusive: jest.fn(async <T,>(operation: () => Promise<T>) => operation()) };
  const photoGateway = {
    inspectManaged: jest.fn(async () => ({ relativePath: 'poop-photos/original.jpg', uri: 'photos/original.jpg',
      byteLength: 6, sha256: 'c'.repeat(64) })),
  };
  const dependencies = {
    snapshotRepository: { getSnapshot: jest.fn(async () => customSnapshot) },
    fileStore: {
      createBuildWorkspace: jest.fn(async () => workspace), deleteArchive: jest.fn(async () => undefined),
      cleanupExpiredTemporary: jest.fn(async () => ({ deleted: 0, failed: 0 })),
      ensureAvailableSpace: jest.fn(async () => undefined),
    },
    archiveGateway,
    photoGateway,
    shareGateway,
    validationService: validationService as never,
    coordinator,
    now: () => new Date(2026, 6, 12, 12, 0).getTime(),
    createId: () => 'backup-1',
    appVersion: '1.0.0',
    timezoneId: () => 'Asia/Shanghai',
    timezoneOffsetMinutes: () => -480,
  };
  return { service: createBackupService(dependencies as never), workspace, archiveGateway, shareGateway, validationService, dependencies };
}

function snapshotWithBottleBreast(amount: number): BackupSnapshot {
  const base = snapshot.records[0];
  return {
    ...snapshot,
    records: [{
      ...base,
      id: 'feeding-bottle-breast',
      client_request_id: 'request-feeding-bottle-breast',
      type: 'feeding',
      source_photo_path: null,
      feeding_type: 'bottle_breast',
      milk_amount_ml: null,
      breast_milk_amount_ml: amount,
      poop_color: null,
    }],
  };
}

describe('BackupService', () => {
  test('creates manifest, JSON, photo entry, validates the resulting archive, and shares only temporary backups', async () => {
    const { service, workspace, archiveGateway, shareGateway, validationService } = setup();
    const result = await service.createAndShare();
    expect(result.filename).toMatch(/^baobao-today-backup-[0-9-]+\.zip$/);
    expect(workspace.writeJson).toHaveBeenCalledWith('records.json', expect.not.stringContaining('poop-photos/original.jpg'));
    expect(workspace.writeJson).toHaveBeenCalledWith('manifest.json', expect.stringContaining('"formatVersion": 2'));
    expect(archiveGateway.createArchive).toHaveBeenCalledWith('cache/backup.zip', expect.arrayContaining([
      { path: 'photos/poop-1.jpg', sourceUri: 'photos/original.jpg' },
    ]));
    expect(validationService.prepare).toHaveBeenCalledWith('cache/backup.zip', expect.stringContaining('verify-'));
    expect(shareGateway.share).toHaveBeenCalledWith('cache/backup.zip', result.filename);
    expect(workspace.cleanup).toHaveBeenCalled();
  });

  test('creates format version two with bottled breast milk in records.json', async () => {
    const { service, workspace } = setup(snapshotWithBottleBreast(80));
    await service.createAndShare();
    expect(workspace.writeJson).toHaveBeenCalledWith(
      'records.json',
      expect.stringContaining('"breast_milk_amount_ml": 80'),
    );
    expect(workspace.writeJson).toHaveBeenCalledWith(
      'manifest.json',
      expect.stringContaining('"formatVersion": 2'),
    );
  });

  test('fails complete backup when a referenced photo is missing and never archives or shares', async () => {
    const { service, archiveGateway, shareGateway, dependencies } = setup();
    (dependencies.photoGateway.inspectManaged as jest.Mock).mockRejectedValueOnce(new Error('missing'));
    await expect(service.createAndShare()).rejects.toThrow(/照片已经不存在/);
    expect(archiveGateway.createArchive).not.toHaveBeenCalled();
    expect(shareGateway.share).not.toHaveBeenCalled();
  });

  test('deduplicates rapid create intent into one archive and one share flow', async () => {
    const { service, dependencies, shareGateway } = setup();
    const first = service.createAndShare();
    const second = service.createAndShare();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(dependencies.snapshotRepository.getSnapshot).toHaveBeenCalledTimes(1);
    expect(shareGateway.share).toHaveBeenCalledTimes(1);
  });

  test('checks conservative peak disk space before writing the archive', async () => {
    const { service, dependencies, archiveGateway } = setup();
    (dependencies.fileStore.ensureAvailableSpace as jest.Mock).mockRejectedValueOnce(new Error('insufficient space'));
    await expect(service.createAndShare()).rejects.toThrow('insufficient space');
    expect(dependencies.fileStore.ensureAvailableSpace).toHaveBeenCalledWith(expect.any(Number));
    expect(archiveGateway.createArchive).not.toHaveBeenCalled();
  });

  test('creates a valid backup for a baby with no records or photos', async () => {
    const { service, archiveGateway } = setup({ ...snapshot, records: [] });
    await service.createAndShare();
    const entries = (archiveGateway.createArchive as jest.Mock).mock.calls[0][1] as { path: string }[];
    expect(entries.map((entry) => entry.path)).toEqual([
      'manifest.json', 'baby.json', 'records.json', 'settings.json',
    ]);
  });

  test('archives all five record types, multiple photos, active sleep, theme, and reminder settings', async () => {
    const base = snapshot.records[0];
    const record = (id: string, type: typeof base.type, eventTimeMs: number) => ({
      ...base, id, client_request_id: `request-${id}`, type, event_time_ms: eventTimeMs,
      sort_time_ms: eventTimeMs, source_photo_path: null, feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null,
      poop_color: null, pee_color: null, pee_amount: null, sleep_start_ms: null, sleep_end_ms: null,
      sleep_status: null, other_title: null,
    });
    const records: BackupSnapshot['records'] = [
      { ...record('feeding-1', 'feeding', 1), feeding_type: 'formula', milk_amount_ml: 60 },
      { ...record('poop-1', 'poop', 2), poop_color: 'yellow', source_photo_path: 'poop-photos/one.jpg' },
      { ...record('poop-2', 'poop', 3), poop_color: 'green', source_photo_path: 'poop-photos/two.jpg' },
      { ...record('pee-1', 'pee', 4), pee_amount: 'small' },
      { ...record('sleep-1', 'sleep', 5), sleep_start_ms: 5, sleep_status: 'sleeping' },
      { ...record('other-1', 'other', 6), other_title: 'bath' },
    ];
    const { service, archiveGateway, workspace } = setup({ ...snapshot, records });
    await service.createAndShare();
    const entries = (archiveGateway.createArchive as jest.Mock).mock.calls[0][1] as { path: string }[];
    expect(entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'photos/poop-1.jpg', 'photos/poop-2.jpg',
    ]));
    expect(workspace.writeJson).toHaveBeenCalledWith('manifest.json', expect.stringContaining('"sleep": 1'));
    expect(workspace.writeJson).toHaveBeenCalledWith('settings.json', expect.stringContaining('"theme_mode": "dark"'));
  });

  test.each([
    ['JSON write', (context: ReturnType<typeof setup>) => context.workspace.writeJson.mockRejectedValueOnce(new Error('write failed'))],
    ['archive creation', (context: ReturnType<typeof setup>) => context.archiveGateway.createArchive.mockRejectedValueOnce(new Error('zip failed'))],
    ['archive self-validation', (context: ReturnType<typeof setup>) => context.validationService.prepare.mockRejectedValueOnce(new Error('verify failed'))],
  ])('cleans partial output when %s fails', async (_label, inject) => {
    const context = setup();
    inject(context);
    await expect(context.service.createAndShare()).rejects.toThrow();
    expect(context.workspace.cleanup).toHaveBeenCalled();
    expect(context.dependencies.fileStore.deleteArchive).toHaveBeenCalledWith('cache/backup.zip');
    expect(context.shareGateway.share).not.toHaveBeenCalled();
  });
});
