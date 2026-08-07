import type { BackupData } from '@/domain/backup/backup-types';

import { createRestoreService } from './restore-service';

const data: BackupData = {
  baby: { id: 'baby-1', name: '小宝', birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 1 },
  records: [{
    id: 'poop-1', client_request_id: 'request-1', create_payload_hash: 'a'.repeat(64), type: 'poop',
    event_time_ms: 1, record_date: '2026-07-10', sort_time_ms: 1, created_at_ms: 1, updated_at_ms: 1,
    note: null, feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null, left_duration_min: null, right_duration_min: null,
    poop_color: 'yellow', poop_texture: null, poop_amount: null, photo_backup_entry: 'photos/photo-1.jpg',
    photo_sha256: 'b'.repeat(64), pee_color: null, pee_amount: null, sleep_start_ms: null,
    sleep_end_ms: null, sleep_status: null, other_title: null,
  }],
  settings: { theme_mode: 'dark', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 120 },
};

function prepared(id: string) {
  return {
    workspace: { archiveUri: `${id}/source.zip` },
    manifest: { backupId: id, entries: [{ path: 'photos/photo-1.jpg', byteLength: 6, sha256: 'b'.repeat(64) }] },
    data,
    photoUris: new Map([['photos/photo-1.jpg', `${id}/photos/photo-1.jpg`]]),
    summary: { babyName: '小宝' },
    dispose: jest.fn(async () => undefined),
  };
}

function setup() {
  const external = prepared('external');
  const rechecked = prepared('rechecked');
  const undo = prepared('undo');
  const validationService = {
    prepare: jest.fn(async (uri: string) => uri === 'safety/last.zip' ? undo : rechecked),
  };
  const fileStore = {
    getSafetyArchiveUri: jest.fn(async () => 'safety/last.zip'),
    promoteSafetyArchive: jest.fn(async () => undefined),
  };
  const restoreRepository = {
    hasCurrentData: jest.fn(async () => true),
    listReferencedPhotoPaths: jest.fn(async () => ['poop-photos/old.jpg']),
    replaceAll: jest.fn(async () => undefined),
  };
  const backupService = {
    createSafetyArchive: jest.fn(async () => ({ uri: 'safety/pending.zip', filename: 'backup.zip' })),
  };
  const photoGateway = {
    restoreStaged: jest.fn(async () => 'poop-photos/new.jpg'),
    deleteManaged: jest.fn(async () => undefined),
  };
  const picker = { pickBackup: jest.fn(async () => ({ canceled: false as const, uri: 'picked.zip', name: 'picked.zip', size: 100 })) };
  const coordinator = { busy: false, runExclusive: jest.fn(async <T,>(operation: () => Promise<T>) => operation()) };
  const reminderSync: jest.MockedFunction<() => Promise<unknown>> = jest.fn(async () => undefined);
  const refreshAppState = jest.fn(async () => undefined);
  const service = createRestoreService({
    validationService: validationService as never,
    fileStore: { ...fileStore, deleteArchive: jest.fn(async () => undefined) } as never,
    restoreRepository,
    backupService: backupService as never,
    photoGateway: photoGateway as never,
    documentPicker: picker,
    coordinator: coordinator as never,
    reminderSync,
    refreshAppState,
    now: () => 100,
    createId: () => 'restore-session',
  });
  return { service, external, rechecked, undo, validationService, fileStore, restoreRepository,
    backupService, photoGateway, picker, reminderSync, refreshAppState };
}

describe('RestoreService replacement and compensation', () => {
  test('picks, validates, previews, safety-backs up, restores photos, replaces SQLite, then cleans old photos', async () => {
    const setupValue = setup();
    const selected = await setupValue.service.pickAndPrepare();
    expect(selected?.summary).toEqual({ babyName: '小宝' });
    const result = await setupValue.service.confirmPrepared();
    expect(setupValue.backupService.createSafetyArchive).toHaveBeenCalled();
    expect(setupValue.fileStore.promoteSafetyArchive).toHaveBeenCalledWith('safety/pending.zip');
    expect(setupValue.photoGateway.restoreStaged).toHaveBeenCalledWith(
      'rechecked/photos/photo-1.jpg', 'restore-session', 'poop-1', 6, 'b'.repeat(64),
    );
    expect(setupValue.restoreRepository.replaceAll).toHaveBeenCalledWith(
      data, new Map([['photos/photo-1.jpg', 'poop-photos/new.jpg']]), 100,
    );
    expect(setupValue.photoGateway.deleteManaged).toHaveBeenCalledWith('poop-photos/old.jpg');
    expect(setupValue.reminderSync).toHaveBeenCalled();
    expect(setupValue.refreshAppState).toHaveBeenCalled();
    expect(result).toEqual({ committed: true, warnings: [] });
  });

  test('cancellation does not create staging or modify data', async () => {
    const value = setup();
    (value.picker.pickBackup as jest.Mock).mockResolvedValueOnce({ canceled: true });
    await expect(value.service.pickAndPrepare()).resolves.toBeNull();
    expect(value.validationService.prepare).not.toHaveBeenCalled();
    expect(value.restoreRepository.replaceAll).not.toHaveBeenCalled();
  });

  test('safety backup failure blocks all restore writes', async () => {
    const value = setup();
    value.backupService.createSafetyArchive.mockRejectedValueOnce(new Error('disk full'));
    await value.service.pickAndPrepare();
    await expect(value.service.confirmPrepared()).rejects.toThrow(/无法创建恢复前安全备份/);
    expect(value.photoGateway.restoreStaged).not.toHaveBeenCalled();
    expect(value.restoreRepository.replaceAll).not.toHaveBeenCalled();
  });

  test('photo failure compensates already copied new photos and preserves SQLite', async () => {
    const value = setup();
    const twoPhotos = { ...value.rechecked, manifest: { ...value.rechecked.manifest, entries: [
      ...value.rechecked.manifest.entries, { path: 'photos/photo-2.jpg', byteLength: 7, sha256: 'c'.repeat(64) },
    ] }, data: { ...data, records: [data.records[0], {
      ...data.records[0], id: 'poop-2', client_request_id: 'request-2',
      photo_backup_entry: 'photos/photo-2.jpg', photo_sha256: 'c'.repeat(64),
    }] }, photoUris: new Map([
      ['photos/photo-1.jpg', 'one.jpg'], ['photos/photo-2.jpg', 'two.jpg'],
    ]) };
    await value.service.pickAndPrepare();
    value.validationService.prepare.mockResolvedValueOnce(twoPhotos as never);
    value.photoGateway.restoreStaged
      .mockResolvedValueOnce('poop-photos/new-1.jpg')
      .mockRejectedValueOnce(new Error('copy failed'));
    await expect(value.service.confirmPrepared()).rejects.toThrow('copy failed');
    expect(value.restoreRepository.replaceAll).not.toHaveBeenCalled();
    expect(value.photoGateway.deleteManaged).toHaveBeenCalledWith('poop-photos/new-1.jpg');
    expect(value.photoGateway.deleteManaged).not.toHaveBeenCalledWith('poop-photos/old.jpg');
  });

  test('SQLite failure removes all new photos and keeps old photos', async () => {
    const value = setup();
    value.restoreRepository.replaceAll.mockRejectedValueOnce(new Error('insert failed'));
    await value.service.pickAndPrepare();
    await expect(value.service.confirmPrepared()).rejects.toThrow('insert failed');
    expect(value.photoGateway.deleteManaged).toHaveBeenCalledWith('poop-photos/new.jpg');
    expect(value.photoGateway.deleteManaged).not.toHaveBeenCalledWith('poop-photos/old.jpg');
  });

  test('post-commit cleanup, reminder, and refresh failures become warnings without rollback', async () => {
    const value = setup();
    value.photoGateway.deleteManaged.mockRejectedValueOnce(new Error('cleanup'));
    value.reminderSync.mockRejectedValueOnce(new Error('reminder'));
    value.refreshAppState.mockRejectedValueOnce(new Error('refresh'));
    await value.service.pickAndPrepare();
    await expect(value.service.confirmPrepared()).resolves.toEqual({
      committed: true, warnings: ['old-photo-cleanup', 'reminder-sync', 'app-refresh'],
    });
    expect(value.restoreRepository.replaceAll).toHaveBeenCalled();
  });

  test('a resolved reminder sync error becomes a post-commit warning', async () => {
    const value = setup();
    value.reminderSync.mockResolvedValueOnce({
      kind: 'sync-error', errorCode: 'reconcile-failed', syncErrorCode: 'reconcile-failed',
    });
    await value.service.pickAndPrepare();

    await expect(value.service.confirmPrepared()).resolves.toEqual({
      committed: true, warnings: ['reminder-sync'],
    });
    expect(value.restoreRepository.replaceAll).toHaveBeenCalled();
  });

  test('undo validates the persistent safety archive and rotates a new safety point before replacement', async () => {
    const value = setup();
    await expect(value.service.prepareUndo()).resolves.toMatchObject({ summary: { babyName: '小宝' } });
    await value.service.confirmPrepared();
    expect(value.validationService.prepare).toHaveBeenNthCalledWith(1, 'safety/last.zip', expect.stringContaining('undo-'));
    expect(value.backupService.createSafetyArchive).toHaveBeenCalled();
    expect(value.fileStore.promoteSafetyArchive).toHaveBeenCalledWith('safety/pending.zip');
    expect(value.restoreRepository.replaceAll).toHaveBeenCalled();
  });

  test('restoring into an empty app skips a meaningless safety backup', async () => {
    const value = setup();
    value.restoreRepository.hasCurrentData.mockResolvedValueOnce(false);
    await value.service.pickAndPrepare();
    await value.service.confirmPrepared();
    expect(value.backupService.createSafetyArchive).not.toHaveBeenCalled();
    expect(value.restoreRepository.replaceAll).toHaveBeenCalled();
  });
});
