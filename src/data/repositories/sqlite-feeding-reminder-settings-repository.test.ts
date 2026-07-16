/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';

import {
  SQLiteFeedingReminderSettingsRepository,
  type ReminderSettingsDatabase,
} from './sqlite-feeding-reminder-settings-repository';

type Value = string | number | null;

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  const database: ReminderSettingsDatabase = {
    ...query,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, repository: new SQLiteFeedingReminderSettingsRepository(database) };
}

describe('SQLite feeding reminder settings repository', () => {
  test('reads the default disabled singleton without treating permission as granted', async () => {
    const { sqlite, repository } = setup();
    await expect(repository.get()).resolves.toEqual({
      intervalMinutes: null,
      notificationId: null,
      scheduledForMs: null,
      sourceRecordId: null,
      permissionPrompted: false,
      syncErrorCode: null,
      updatedAtMs: 0,
    });
    sqlite.close();
  });

  test('stores an enabled interval, permission prompt marker, and complete coordination metadata', async () => {
    const { sqlite, repository } = setup();
    await repository.setInterval(120, 10);
    await repository.markPermissionPrompted(11);
    await repository.saveMetadata({
      notificationId: 'native-1', scheduledForMs: 5000, sourceRecordId: 'feeding-1',
    }, 12);
    await expect(repository.get()).resolves.toMatchObject({
      intervalMinutes: 120,
      notificationId: 'native-1',
      scheduledForMs: 5000,
      sourceRecordId: 'feeding-1',
      permissionPrompted: true,
      syncErrorCode: null,
      updatedAtMs: 12,
    });
    sqlite.close();
  });

  test('disabling and clearing metadata never retains a stale native identifier', async () => {
    const { sqlite, repository } = setup();
    await repository.setInterval(120, 10);
    await repository.saveMetadata({
      notificationId: 'native-1', scheduledForMs: 5000, sourceRecordId: 'feeding-1',
    }, 11);
    await repository.setInterval(null, 12);
    await expect(repository.get()).resolves.toMatchObject({
      intervalMinutes: null, notificationId: null, scheduledForMs: null, sourceRecordId: null,
    });
    sqlite.close();
  });

  test('stores only bounded sync error codes while clearing coordination metadata', async () => {
    const { sqlite, repository } = setup();
    await repository.setInterval(180, 10);
    await repository.clearMetadata('schedule-failed', 11);
    await expect(repository.get()).resolves.toMatchObject({
      intervalMinutes: 180, notificationId: null, syncErrorCode: 'schedule-failed',
    });
    await expect(repository.clearMetadata('native stack trace' as never, 12)).rejects.toThrow();
    sqlite.close();
  });
});
