import * as SQLite from 'expo-sqlite';

import type { BackupData, BackupRecord } from '@/domain/backup/backup-types';
import { toLocalDateKey } from '@/domain/date/local-date';
import { MIGRATIONS, runMigrations, type MigrationDatabase } from '@/data/database/migrations';
import { RECORDS_FINAL_OBJECT_NAMES, RECORDS_V6_OBJECT_NAMES } from '@/data/database/records-schema';
import { SQLiteRestoreRepository } from '@/data/repositories/sqlite-restore-repository';
import { SQLiteSleepRepository } from '@/data/repositories/sqlite-sleep-repository';

export const VERIFICATION_DATABASE_NAME = 'baobao-today-migration-verification.db';

type SQLiteValue = string | number | null;

interface VerificationDatabase extends MigrationDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
  closeAsync(): Promise<void>;
}

export interface VerificationDependencies {
  openDatabaseAsync(name: string): Promise<VerificationDatabase>;
  deleteDatabaseAsync(name: string): Promise<void>;
  migrateDatabase?(database: MigrationDatabase, options?: { targetVersion?: number }): Promise<void>;
  verifyRepositoryPath?(database: VerificationDatabase): Promise<RepositoryVerificationResult>;
}

type RepositoryVerificationResult = {
  finalRecordCount: number;
  restoredRecordDate: string;
  normalWriteRecordDate: string;
  restoreRepositoryVerified: true;
  normalRepositoryWriteVerified: true;
  invalidSleepRejected: true;
  sleepingConstraintVerified: true;
};

const defaultDependencies: VerificationDependencies = {
  openDatabaseAsync: async (name) => {
    const database = await SQLite.openDatabaseAsync(name);
    return {
      execAsync: (sql) => database.execAsync(sql),
      getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
      getAllAsync: (sql, ...params) => database.getAllAsync(sql, ...params),
      withExclusiveTransactionAsync: (task) =>
        database.withExclusiveTransactionAsync((transaction) => task({
          execAsync: (sql) => transaction.execAsync(sql),
          getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
          getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
          runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
        })),
      runAsync: (sql, ...params) => database.runAsync(sql, ...params),
      closeAsync: () => database.closeAsync(),
    };
  },
  deleteDatabaseAsync: (name) => SQLite.deleteDatabaseAsync(name),
  migrateDatabase: runMigrations,
};

async function deleteVerificationDatabase(dependencies: VerificationDependencies) {
  try {
    await dependencies.deleteDatabaseAsync(VERIFICATION_DATABASE_NAME);
  } catch {
    // A missing stale verification database is already the desired state.
  }
}

function baseColumns() {
  return `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms, note`;
}

async function createV4Fixture(database: VerificationDatabase) {
  for (const migration of MIGRATIONS.filter((item) => item.version <= 4)) {
    await database.execAsync(migration.sql);
  }
  await database.execAsync('PRAGMA user_version = 4;');

  const nowMs = Date.now() - 60_000;
  const completedStartMs = nowMs - 3 * 60 * 60 * 1_000;
  const completedEndMs = nowMs - 2 * 60 * 60 * 1_000;
  const activeStartMs = nowMs - 30 * 60 * 1_000;
  const hash = (digit: string) => digit.repeat(64);

  await database.runAsync(`INSERT INTO records (${baseColumns()}, feeding_type, milk_amount_ml)
    VALUES ('native-formula', 'native-request-formula', ?, 'feeding', ?, ?, ?, ?, ?, 'formula', 'formula', 60)`,
    hash('1'), nowMs - 5, toLocalDateKey(nowMs - 5), nowMs - 5, nowMs - 5, nowMs - 5);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, feeding_type, left_duration_min, right_duration_min)
    VALUES ('native-breast', 'native-request-breast', ?, 'feeding', ?, ?, ?, ?, ?, NULL, 'breast', 8, 0)`,
    hash('2'), nowMs - 4, toLocalDateKey(nowMs - 4), nowMs - 4, nowMs - 4, nowMs - 4);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, feeding_type, milk_amount_ml, left_duration_min, right_duration_min)
    VALUES ('native-mixed', 'native-request-mixed', ?, 'feeding', ?, ?, ?, ?, ?, NULL, 'mixed', 30, 5, 0)`,
    hash('3'), nowMs - 3, toLocalDateKey(nowMs - 3), nowMs - 3, nowMs - 3, nowMs - 3);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, poop_color, photo_uri)
    VALUES ('native-poop', 'native-request-poop', ?, 'poop', ?, ?, ?, ?, ?, 'photo', 'yellow', 'poop-photos/native-kept.jpg')`,
    hash('4'), nowMs - 2, toLocalDateKey(nowMs - 2), nowMs - 2, nowMs - 2, nowMs - 2);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, pee_color, pee_amount)
    VALUES ('native-pee', 'native-request-pee', ?, 'pee', ?, ?, ?, ?, ?, NULL, 'pale-yellow', 'small')`,
    hash('5'), nowMs - 1, toLocalDateKey(nowMs - 1), nowMs - 1, nowMs - 1, nowMs - 1);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES ('native-completed', 'native-request-completed', ?, 'sleep', NULL, '1999-01-01', ?, ?, ?, NULL, ?, ?, 'completed')`,
    hash('6'), completedStartMs, completedStartMs, completedStartMs, completedStartMs, completedEndMs);
  await database.runAsync(`INSERT INTO records (${baseColumns()}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES ('native-active', 'native-request-active', ?, 'sleep', NULL, '1999-01-01', ?, ?, ?, 'active', ?, NULL, 'sleeping')`,
    hash('7'), activeStartMs, activeStartMs, activeStartMs, activeStartMs);

  return { expectedCount: 7 };
}

async function verifyMigratedDatabase(
  database: VerificationDatabase,
  expectedVersion: number,
  expectedCount: number,
  expectedPhoto: { id: string; path: string } = {
    id: 'native-poop',
    path: 'poop-photos/native-kept.jpg',
  },
) {
  const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version !== expectedVersion) {
    throw new Error(`Native migration verification did not reach user_version ${expectedVersion}`);
  }
  const count = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM records');
  if (count?.count !== expectedCount) throw new Error('Native migration verification record count changed');
  const invalidSleep = await database.getFirstAsync<{ count: number }>(`
    SELECT COUNT(*) AS count FROM records
    WHERE type='sleep' AND (event_time_ms <> sleep_start_ms OR sort_time_ms <> sleep_start_ms)
  `);
  if (invalidSleep?.count !== 0) throw new Error('Native migration verification sleep derived fields differ');
  const photo = await database.getFirstAsync<{ photo_uri: string }>(
    'SELECT photo_uri FROM records WHERE id=?',
    expectedPhoto.id,
  );
  if (photo?.photo_uri !== expectedPhoto.path) {
    throw new Error('Native migration verification changed the managed photo path');
  }
  const objects = await database.getAllAsync<{ name: string }>(`
    SELECT name FROM sqlite_schema
    WHERE tbl_name='records' AND type IN ('index','trigger') AND sql IS NOT NULL
  `);
  const names = new Set(objects.map((row) => row.name));
  for (const required of RECORDS_FINAL_OBJECT_NAMES) {
    if (!names.has(required)) throw new Error(`Native migration verification missing ${required}`);
  }
  for (const required of RECORDS_V6_OBJECT_NAMES) {
    if (!names.has(required)) throw new Error(`Native migration verification missing ${required}`);
  }
}

function backupRecord(
  id: string,
  type: BackupRecord['type'],
  eventTimeMs: number,
  recordDate: string,
): BackupRecord {
  return {
    id,
    client_request_id: `request-${id}`,
    create_payload_hash: 'a'.repeat(64),
    type,
    event_time_ms: eventTimeMs,
    record_date: recordDate,
    sort_time_ms: eventTimeMs,
    created_at_ms: eventTimeMs,
    updated_at_ms: eventTimeMs,
    note: null,
    feeding_type: null,
    milk_amount_ml: null,
    left_duration_min: null,
    right_duration_min: null,
    poop_color: null,
    poop_texture: null,
    poop_amount: null,
    photo_backup_entry: null,
    photo_sha256: null,
    pee_color: null,
    pee_amount: null,
    sleep_start_ms: null,
    sleep_end_ms: null,
    sleep_status: null,
    other_title: null,
  };
}

async function verifyRepositoryPath(database: VerificationDatabase): Promise<RepositoryVerificationResult> {
  const sourceStartMs = Date.UTC(2026, 6, 10, 16, 30);
  const historicalRecordDate = '2026-07-10';
  if (toLocalDateKey(sourceStartMs) === historicalRecordDate) {
    throw new Error('Native timezone fixture does not differ from the current device timezone');
  }
  const feeding = { ...backupRecord('restore-feeding', 'feeding', sourceStartMs - 4, historicalRecordDate),
    feeding_type: 'formula' as const, milk_amount_ml: 60 };
  const poop = { ...backupRecord('restore-poop', 'poop', sourceStartMs - 3, historicalRecordDate),
    poop_color: 'yellow' as const, photo_backup_entry: 'photos/restore-poop.jpg', photo_sha256: 'b'.repeat(64) };
  const pee = { ...backupRecord('restore-pee', 'pee', sourceStartMs - 2, historicalRecordDate),
    pee_color: 'pale-yellow' as const, pee_amount: 'small' as const };
  const sleep = { ...backupRecord('restore-sleep', 'sleep', sourceStartMs, historicalRecordDate),
    sleep_start_ms: sourceStartMs, sleep_end_ms: sourceStartMs + 60 * 60 * 1000, sleep_status: 'completed' as const };
  const other = { ...backupRecord('restore-other', 'other', sourceStartMs - 1, historicalRecordDate),
    other_title: 'bath' };
  const data: BackupData = {
    baby: { id: 'restore-baby', name: 'Native Baby', birth_date: '2026-06-01',
      created_at_ms: sourceStartMs, updated_at_ms: sourceStartMs },
    records: [feeding, poop, pee, sleep, other],
    settings: { theme_mode: 'dark', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null },
  };
  const restoreRepository = new SQLiteRestoreRepository(database);
  await restoreRepository.replaceAll(
    data,
    new Map([['photos/restore-poop.jpg', 'poop-photos/native-restored.jpg']]),
    Date.now(),
  );
  const restored = await database.getFirstAsync<{ record_date: string; event_time_ms: number; sleep_start_ms: number }>(
    `SELECT record_date, event_time_ms, sleep_start_ms FROM records WHERE id='restore-sleep'`,
  );
  if (restored?.record_date !== historicalRecordDate || restored.event_time_ms !== sourceStartMs
    || restored.sleep_start_ms !== sourceStartMs) {
    throw new Error('Native RestoreRepository did not preserve historical sleep ownership and timestamps');
  }

  const nowMs = Date.now();
  const normalStartMs = nowMs - 60_000;
  const sleepRepository = new SQLiteSleepRepository(database, async () => 'c'.repeat(64));
  const normal = await sleepRepository.start({
    id: 'native-normal-sleep',
    clientRequestId: 'native-normal-sleep-request',
    input: { startMs: normalStartMs, note: null },
    nowMs,
  });
  const expectedNormalDate = toLocalDateKey(normalStartMs);
  if (normal.record.recordDate !== expectedNormalDate || normal.record.eventTimeMs !== normalStartMs
    || normal.record.sortTimeMs !== normalStartMs) {
    throw new Error('Native SleepRepository did not derive current business fields');
  }

  let invalidSleepError = '';
  try {
    await database.runAsync(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status
    ) VALUES ('native-invalid-sleep', 'native-invalid-sleep-request', ?, 'sleep', ?, ?, ?, ?, ?, ?, ?, 'sleeping')`,
    'd'.repeat(64), normalStartMs - 1, expectedNormalDate, normalStartMs - 1, nowMs, nowMs,
    normalStartMs - 1, nowMs);
  } catch (error) { invalidSleepError = String(error); }
  if (!/invalid sleep fields/i.test(invalidSleepError)) {
    throw new Error('Native migration verification accepted sleeping with an end time');
  }

  let duplicateError = '';
  try {
    await database.runAsync(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status
    ) VALUES ('native-active-2', 'native-request-active-2', ?, 'sleep', ?, ?, ?, ?, ?, ?, NULL, 'sleeping')`,
    'e'.repeat(64), normalStartMs - 2, expectedNormalDate, normalStartMs - 2, nowMs, nowMs,
    normalStartMs - 2);
  } catch (error) { duplicateError = String(error); }
  if (!/UNIQUE constraint failed: records\.type/i.test(duplicateError)) {
    throw new Error('Native migration verification did not enforce one active sleep');
  }

  const count = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM records');
  if (count?.count !== 6) throw new Error('Native repository verification record count differs');
  return {
    finalRecordCount: 6,
    restoredRecordDate: historicalRecordDate,
    normalWriteRecordDate: expectedNormalDate,
    restoreRepositoryVerified: true,
    normalRepositoryWriteVerified: true,
    invalidSleepRejected: true,
    sleepingConstraintVerified: true,
  };
}

export async function verifyCriticalConstraintsInIsolatedDatabase(
  dependencies: VerificationDependencies = defaultDependencies,
) {
  await deleteVerificationDatabase(dependencies);
  let database: VerificationDatabase | null = null;
  try {
    database = await dependencies.openDatabaseAsync(VERIFICATION_DATABASE_NAME);
    const fixture = await createV4Fixture(database);
    const migrate = dependencies.migrateDatabase ?? runMigrations;
    await migrate(database, { targetVersion: 7 });
    await verifyMigratedDatabase(database, 7, fixture.expectedCount);
    await migrate(database);
    await verifyMigratedDatabase(database, 8, fixture.expectedCount);
    const repositoryResult = await (dependencies.verifyRepositoryPath ?? verifyRepositoryPath)(database);

    await database.closeAsync();
    database = await dependencies.openDatabaseAsync(VERIFICATION_DATABASE_NAME);
    await verifyMigratedDatabase(database, 8, repositoryResult.finalRecordCount, {
      id: 'restore-poop',
      path: 'poop-photos/native-restored.jpg',
    });
    const reopenedRestore = await database.getFirstAsync<{ record_date: string }>(
      `SELECT record_date FROM records WHERE id='restore-sleep'`,
    );
    const reopenedNormal = await database.getFirstAsync<{ record_date: string }>(
      `SELECT record_date FROM records WHERE id='native-normal-sleep'`,
    );
    if (dependencies.verifyRepositoryPath === undefined
      && (reopenedRestore?.record_date !== repositoryResult.restoredRecordDate
        || reopenedNormal?.record_date !== repositoryResult.normalWriteRecordDate)) {
      throw new Error('Native repository verification data did not persist after reopen');
    }
    return {
      migrationVerified: true,
      reopenedPersistenceVerified: true,
      ...repositoryResult,
      userVersion: 8,
      recordCount: repositoryResult.finalRecordCount,
    };
  } finally {
    await database?.closeAsync();
    await deleteVerificationDatabase(dependencies);
  }
}
