/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite; the app does not install Node typings.
import { DatabaseSync } from 'node:sqlite';
import { BackupRestoreCoordinator } from './backup-restore-coordinator';
import { createRestoreService } from './restore-service';
import { MIGRATIONS } from '@/data/database/migrations';
import { SQLiteRestoreRepository, type RestoreDatabase } from '@/data/repositories/sqlite-restore-repository';
import { validateBackupData } from '@/domain/backup/backup-validation';

type Value = string | number | null;

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) {
    sqlite.exec(migration.sql); sqlite.exec(`PRAGMA user_version=${migration.version}`);
  }
  sqlite.exec(`INSERT INTO baby (id,singleton_key,name,birth_date,created_at_ms,updated_at_ms)
    VALUES ('old-baby',1,'旧宝宝','2026-01-01',1,1)`);
  const query = {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  const database: RestoreDatabase = {
    getFirstAsync: query.getFirstAsync, getAllAsync: query.getAllAsync,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const data = validateBackupData({
    baby: { id: 'restored-baby', name: '恢复宝宝', birth_date: '2026-06-01', created_at_ms: 10, updated_at_ms: 20 },
    records: [],
    settings: { theme_mode: 'light', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null },
  });
  const item = (id: string) => ({
    workspace: { archiveUri: `${id}/archive.zip` }, manifest: { entries: [] }, data,
    photoUris: new Map(), summary: { babyName: data.baby.name }, dispose: jest.fn(async () => undefined),
  });
  const selected = item('selected'); const rechecked = item('rechecked');
  const repository = new SQLiteRestoreRepository(database);
  const coordinator = new BackupRestoreCoordinator();
  const backupService = { createSafetyArchive: jest.fn(async () => ({ uri: 'safety/pending.zip', filename: 'backup.zip' })) };
  const promoteSafetyArchive = jest.fn(async () => undefined);
  const refreshAppState = jest.fn(async () => {
    expect(sqlite.prepare('SELECT id FROM baby').get()).toEqual({ id: 'restored-baby' });
  });
  const service = createRestoreService({
    validationService: { prepare: jest.fn().mockResolvedValueOnce(selected).mockResolvedValueOnce(rechecked) },
    fileStore: { getSafetyArchiveUri: async () => 'safety/last.zip', promoteSafetyArchive, deleteArchive: async () => undefined },
    restoreRepository: repository, backupService: backupService as never,
    photoGateway: { restoreStaged: jest.fn(), deleteManaged: jest.fn() } as never,
    documentPicker: { pickBackup: async () => ({ canceled: false, uri: 'picked.zip', name: 'picked.zip', size: 100 }) },
    coordinator, reminderSync: async () => undefined, refreshAppState,
    now: () => 100, createId: () => 'restore',
  });
  return { sqlite, selected, rechecked, repository, coordinator, backupService, promoteSafetyArchive, refreshAppState, service };
}

test.each(['selected', 'rechecked', 'both'] as const)(
  'R02: %s staging cleanup failure retains a committed SQLite result and releases the preview',
  async (failure) => {
    const value = setup();
    try {
      if (failure !== 'rechecked') value.selected.dispose.mockRejectedValueOnce(new Error('selected cleanup'));
      if (failure !== 'selected') value.rechecked.dispose.mockRejectedValueOnce(new Error('rechecked cleanup'));
      await value.service.pickAndPrepare();
      await expect(value.service.confirmPrepared()).resolves.toEqual({
        committed: true, warnings: ['restore-workspace-cleanup'],
      });
      expect(value.sqlite.prepare('SELECT id,name FROM baby').get()).toEqual({ id: 'restored-baby', name: '恢复宝宝' });
      expect(value.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(value.selected.dispose).toHaveBeenCalledTimes(1);
      expect(value.rechecked.dispose).toHaveBeenCalledTimes(1);
      expect(value.refreshAppState).toHaveBeenCalledTimes(1);
      expect(value.promoteSafetyArchive).toHaveBeenCalledWith('safety/pending.zip');
      expect(value.coordinator.busy).toBe(false);
      await expect(value.service.confirmPrepared()).rejects.toThrow('请先选择并校验完整备份');
      expect(value.backupService.createSafetyArchive).toHaveBeenCalledTimes(1);
    } finally { value.sqlite.close(); }
  },
);

test('R02: failed replacement keeps its primary error despite two failed staging cleanups', async () => {
  const value = setup();
  try {
    const primary = new Error('replacement failed');
    jest.spyOn(value.repository, 'replaceAll').mockRejectedValueOnce(primary);
    value.selected.dispose.mockRejectedValueOnce(new Error('selected cleanup'));
    value.rechecked.dispose.mockRejectedValueOnce(new Error('rechecked cleanup'));
    await value.service.pickAndPrepare();
    await expect(value.service.confirmPrepared()).rejects.toBe(primary);
    expect(value.sqlite.prepare('SELECT id FROM baby').get()).toEqual({ id: 'old-baby' });
    expect(value.selected.dispose).toHaveBeenCalledTimes(1);
    expect(value.rechecked.dispose).toHaveBeenCalledTimes(1);
    expect(value.refreshAppState).not.toHaveBeenCalled();
    expect(value.coordinator.busy).toBe(false);
    await expect(value.service.confirmPrepared()).rejects.toThrow('请先选择并校验完整备份');
  } finally { value.sqlite.close(); }
});
