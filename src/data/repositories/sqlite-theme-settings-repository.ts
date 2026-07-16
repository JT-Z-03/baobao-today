import type { SQLiteDatabase } from 'expo-sqlite';

import type { ThemeSettingsRepository } from '@/application/ports/theme-settings';
import type { BackupThemeMode } from '@/domain/backup/backup-types';

type SQLiteValue = string | number | null;

export interface ThemeSettingsQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface ThemeSettingsDatabase extends ThemeSettingsQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: ThemeSettingsQueryDatabase) => Promise<void>): Promise<void>;
}

function validMode(mode: string): mode is BackupThemeMode {
  return mode === 'system' || mode === 'light' || mode === 'dark';
}

export class SQLiteThemeSettingsRepository implements ThemeSettingsRepository {
  constructor(private readonly database: ThemeSettingsDatabase) {}

  async get() {
    const row = await this.database.getFirstAsync<{ theme_mode: string }>(`
      SELECT theme_mode FROM app_settings WHERE singleton_key=1
    `);
    if (!row || !validMode(row.theme_mode)) throw new Error('主题设置无效');
    return row.theme_mode;
  }

  async set(mode: BackupThemeMode, nowMs: number) {
    if (!validMode(mode)) throw new Error('主题模式无效');
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE app_settings SET theme_mode=?, updated_at_ms=? WHERE singleton_key=1`, mode, nowMs);
    });
  }
}

export function createSQLiteThemeSettingsRepository(database: SQLiteDatabase) {
  const query: ThemeSettingsQueryDatabase = {
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    runAsync: (sql, ...params) => database.runAsync(sql, ...params),
  };
  return new SQLiteThemeSettingsRepository({
    ...query,
    withExclusiveTransactionAsync: (task) => database.withExclusiveTransactionAsync((transaction) => task({
      getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
      runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
    })),
  });
}
