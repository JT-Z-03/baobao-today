import { runMigrations, type MigrationDatabase } from '@/data/database/migrations';

export interface BusinessDatabase extends MigrationDatabase {
  execAsync(sql: string): Promise<void>;
}

export async function initializeBusinessDatabase(database: BusinessDatabase) {
  await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await runMigrations(database);
}
