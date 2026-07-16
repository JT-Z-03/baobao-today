/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import { SQLiteThemeSettingsRepository, type ThemeSettingsDatabase } from './sqlite-theme-settings-repository';

type Value = string | number | null;

test('persists only system, light, or dark theme mode in SQLite', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  const database: ThemeSettingsDatabase = {
    ...query,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const repository = new SQLiteThemeSettingsRepository(database);
  await expect(repository.get()).resolves.toBe('system');
  await repository.set('dark', 100);
  await expect(repository.get()).resolves.toBe('dark');
  await expect(repository.set('purple' as never, 101)).rejects.toThrow(/主题/);
  expect(sqlite.prepare(`SELECT updated_at_ms FROM app_settings`).get()).toEqual({ updated_at_ms: 100 });
  sqlite.close();
});
