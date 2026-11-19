import type { BackupData } from '@/domain/backup/backup-types';
import type { BackupProgress } from '@/application/ports/backup';

import { createRestoreService } from './restore-service';
import { BackupRestoreCoordinator } from './backup-restore-coordinator';

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
  const refreshAppState = jest.fn(async (): Promise<void> => undefined);
  const workflow = { begin: jest.fn(async (_id: string) => undefined), end: jest.fn(async (_id: string, _committed: boolean) => undefined) };
  const dependencies = {
    validationService: validationService as never,
    fileStore: { ...fileStore, deleteArchive: jest.fn(async () => undefined) } as never,
    restoreRepository,
    backupService: backupService as never,
    photoGateway: photoGateway as never,
    documentPicker: picker,
    coordinator: coordinator as never,
    reminderSync,
    refreshAppState,
    workflow,
    now: () => 100,
    createId: () => 'restore-session',
  };
  const service = createRestoreService(dependencies);
  return { service, external, rechecked, undo, validationService, fileStore, restoreRepository,
    backupService, photoGateway, picker, reminderSync, refreshAppState, workflow, dependencies };
}

describe('RestoreService replacement and compensation', () => {
  test('publishes the confirmed source once after refresh across service recreation', async () => {
    const value = setup();
    let enteredRefresh!: () => void;
    const refreshing = new Promise<void>((resolve) => { enteredRefresh = resolve; });
    let finishRefresh!: () => void;
    value.refreshAppState.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
      enteredRefresh();
    }));
    await value.service.prepareUndo();
    await value.service.pickAndPrepare();
    expect(value.service.getCompletion()).toBeNull();
    const restoring = value.service.confirmPrepared();
    await refreshing;
    const renewed = createRestoreService(value.dependencies);
    const notified = jest.fn(() => renewed.getCompletion());
    renewed.subscribeResult(notified);
    expect(renewed.getCompletion()).toBeNull();
    finishRefresh();
    await restoring;
    expect(notified).toHaveReturnedWith('restore');
    expect(renewed.getResult()).toBeNull();
    expect(renewed.takeCompletion()).toBe('restore');
    expect(value.service.takeCompletion()).toBeNull();

    await renewed.prepareUndo();
    await renewed.confirmPrepared();
    expect(value.service.takeCompletion()).toBe('undo');
    expect(renewed.takeCompletion()).toBeNull();
  });

  test('an unclaimed completion allows a new confirmation and expires even if it fails', async () => {
    const value = setup();
    await value.service.pickAndPrepare();
    await value.service.confirmPrepared();
    expect(value.service.getCompletion()).toBe('restore');
    await value.service.prepareUndo();
    value.restoreRepository.replaceAll.mockRejectedValueOnce(new Error('insert failed'));
    const restoring = value.service.confirmPrepared();
    expect(value.service.getCompletion()).toBeNull();
    await expect(restoring).rejects.toThrow('insert failed');
    expect(value.service.takeCompletion()).toBeNull();
  });

  test('identifies the backup that actually finished preparation when previews overlap', async () => {
    const value = setup();
    let finishPicking!: () => void;
    value.picker.pickBackup.mockImplementationOnce(() => new Promise((resolve) => {
      finishPicking = () => resolve({ canceled: false, uri: 'picked.zip', name: 'picked.zip', size: 100 });
    }));
    const picking = value.service.pickAndPrepare();
    await value.service.prepareUndo();
    finishPicking();
    await picking;
    await value.service.confirmPrepared();
    expect(value.validationService.prepare.mock.calls.at(-1)?.[0]).toBe(value.rechecked.workspace.archiveUri);
    expect(value.service.takeCompletion()).toBe('restore');
  });

  test('retains all five warnings across service recreation and retries only unfinished work', async () => {
    const value = setup();
    value.workflow.end.mockRejectedValueOnce(new Error('metadata'));
    value.photoGateway.deleteManaged.mockRejectedValueOnce(new Error('cleanup'));
    value.reminderSync.mockRejectedValueOnce(new Error('reminder'));
    value.refreshAppState.mockRejectedValueOnce(new Error('refresh'));
    value.rechecked.dispose.mockRejectedValueOnce(new Error('workspace'));
    await value.service.pickAndPrepare();
    const result = await value.service.confirmPrepared();
    expect(result.warnings).toEqual(['draft-state', 'old-photo-cleanup', 'reminder-sync', 'restore-workspace-cleanup', 'app-refresh']);
    const renewed = createRestoreService(value.dependencies);
    expect(renewed.getResult()?.warnings).toEqual(result.warnings);
    expect(renewed.takeCompletion()).toBeNull();
    await expect(renewed.pickAndPrepare()).rejects.toThrow('请先处理或确认上次恢复结果');
    value.reminderSync.mockResolvedValueOnce({ kind: 'sync-error' });
    await renewed.retryPostRestore();
    expect(renewed.getResult()?.warnings).toEqual(['reminder-sync']);
    await renewed.retryPostRestore();
    expect(renewed.getResult()?.warnings).toEqual([]);
    expect(renewed.takeCompletion()).toBeNull();
    expect(value.restoreRepository.replaceAll).toHaveBeenCalledTimes(1);
    expect(value.backupService.createSafetyArchive).toHaveBeenCalledTimes(1);
    expect(value.workflow.end).toHaveBeenCalledTimes(2);
    expect(value.refreshAppState).toHaveBeenCalledTimes(2);
    renewed.acknowledgeResult();
    expect(value.service.getResult()).toBeNull();
  });

  test('an in-flight retry blocks acknowledgement and duplicate retry, and acknowledgement discards old work', async () => {
    const value = setup();
    value.reminderSync.mockRejectedValueOnce(new Error('reminder'));
    await value.service.pickAndPrepare(); await value.service.confirmPrepared();
    let finish!: () => void;
    value.reminderSync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const retry = value.service.retryPostRestore();
    expect(value.service.getResult()?.busy).toBe(true);
    value.service.acknowledgeResult();
    expect(value.service.getResult()).not.toBeNull();
    await value.service.retryPostRestore();
    expect(value.reminderSync).toHaveBeenCalledTimes(2);
    finish(); await retry;
    value.service.acknowledgeResult();
    await value.service.retryPostRestore();
    expect(value.reminderSync).toHaveBeenCalledTimes(2);
    await value.service.pickAndPrepare(); await value.service.confirmPrepared();
    expect(value.restoreRepository.replaceAll).toHaveBeenCalledTimes(2);
  });

  test('progress and receipt listeners cannot convert a committed restore into failure', async () => {
    const value = setup();
    value.reminderSync.mockRejectedValueOnce(new Error('reminder'));
    value.service.subscribeResult(() => { throw new Error('detached view'); });
    const observer = jest.fn((_progress: BackupProgress) => { throw new Error('detached progress view'); });
    await value.service.pickAndPrepare();
    await expect(value.service.confirmPrepared(observer)).resolves.toEqual({ committed: true, warnings: ['reminder-sync'] });
    expect(observer.mock.calls.map(([progress]) => progress)).toEqual([
      { stage: 'restore-photos', completed: 0, total: 1, unit: 'files' },
      { stage: 'restore-photos', completed: 1, total: 1, unit: 'files' },
      { stage: 'replace-data' }, { stage: 'post-restore' },
    ]);
  });

  test('waits for actual refresh outside the business lock, blocks another restore and retries refresh without replacing data', async () => {
    const value = setup();
    const coordinator = new BackupRestoreCoordinator();
    let rejectRefresh!: (error: Error) => void;
    let enteredRefresh!: () => void;
    const entered = new Promise<void>((resolve) => { enteredRefresh = resolve; });
    const refreshAppState = jest.fn(async () => {
      expect(coordinator.busy).toBe(false);
      await coordinator.runExclusive(async () => undefined);
    }).mockImplementationOnce(async () => {
      expect(coordinator.busy).toBe(false);
      await coordinator.runExclusive(async () => undefined);
      enteredRefresh();
      await new Promise<void>((_resolve, reject) => { rejectRefresh = reject; });
    });
    const dependencies = { ...value.dependencies, coordinator, refreshAppState };
    const service = createRestoreService(dependencies);
    await service.pickAndPrepare();
    const restoring = service.confirmPrepared();
    await entered;
    const renewed = createRestoreService(dependencies);
    expect(renewed.getResult()?.busy).toBe(true);
    await expect(renewed.pickAndPrepare()).rejects.toThrow('正在处理恢复');
    rejectRefresh(new Error('initialization failed'));
    await expect(restoring).resolves.toEqual({ committed: true, warnings: ['app-refresh'] });
    await renewed.retryPostRestore();
    expect(renewed.getResult()?.warnings).toEqual([]);
    expect(refreshAppState).toHaveBeenCalledTimes(2);
    expect(value.restoreRepository.replaceAll).toHaveBeenCalledTimes(1);
    expect(value.backupService.createSafetyArchive).toHaveBeenCalledTimes(1);
  });
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
    await value.service.prepareUndo();
    await value.service.cancelPrepared();
    await expect(value.service.confirmPrepared()).rejects.toThrow('请先选择');
    expect(value.service.getCompletion()).toBeNull();
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
