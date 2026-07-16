/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';

type Value = string | number | null;

function adapter(sqlite: InstanceType<typeof DatabaseSync>): MigrationDatabase {
  const query = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  return {
    getFirstAsync: query.getFirstAsync,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

function createV6Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.filter((item) => item.version <= 6)) sqlite.exec(migration.sql);
  sqlite.exec('PRAGMA user_version = 6');
  sqlite.prepare(`UPDATE app_settings SET feeding_reminder_minutes=120,
    scheduled_notification_id='stale-native-id', notification_permission_prompted=1,
    updated_at_ms=10 WHERE singleton_key=1`).run();
  const hash = (digit: string) => digit.repeat(64);
  const base = `id, client_request_id, create_payload_hash, type, event_time_ms,
    record_date, sort_time_ms, created_at_ms, updated_at_ms`;
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml)
    VALUES ('feeding', 'r-feeding', ?, 'feeding', 1, '1970-01-01', 1, 1, 1, 'formula', 60)`).run(hash('1'));
  sqlite.prepare(`INSERT INTO records (${base})
    VALUES ('poop', 'r-poop', ?, 'poop', 2, '1970-01-01', 2, 2, 2)`).run(hash('2'));
  sqlite.prepare(`INSERT INTO records (${base})
    VALUES ('pee', 'r-pee', ?, 'pee', 3, '1970-01-01', 3, 3, 3)`).run(hash('3'));
  sqlite.prepare(`INSERT INTO records (${base}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES ('sleep', 'r-sleep', ?, 'sleep', 4, '1970-01-01', 4, 4, 4, 4, 5, 'completed')`).run(hash('4'));
  sqlite.prepare(`INSERT INTO records (${base}, other_title)
    VALUES ('other', 'r-other', ?, 'other', 5, '1970-01-01', 5, 5, 5, '洗澡')`).run(hash('5'));
  return sqlite;
}

describe('feeding reminder migration v7', () => {
  test('upgrades v6 without rebuilding records or losing five record types', async () => {
    const sqlite = createV6Fixture();
    await runMigrations(adapter(sqlite), { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(sqlite.prepare('SELECT type, COUNT(*) count FROM records GROUP BY type ORDER BY type').all())
      .toHaveLength(5);
    expect(sqlite.prepare(`SELECT feeding_reminder_minutes, scheduled_notification_id,
      feeding_reminder_scheduled_for_ms, feeding_reminder_source_record_id,
      feeding_reminder_sync_error_code, notification_permission_prompted
      FROM app_settings WHERE singleton_key=1`).get()).toEqual({
        feeding_reminder_minutes: 120,
        scheduled_notification_id: null,
        feeding_reminder_scheduled_for_ms: null,
        feeding_reminder_source_record_id: null,
        feeding_reminder_sync_error_code: null,
        notification_permission_prompted: 1,
      });
    expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE name='records_one_sleeping_unique'`).get())
      .toEqual({ name: 'records_one_sleeping_unique' });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test('enforces interval and coordination metadata constraints', async () => {
    const sqlite = createV6Fixture();
    await runMigrations(adapter(sqlite));
    expect(() => sqlite.prepare(`UPDATE app_settings SET feeding_reminder_minutes=14`).run())
      .toThrow(/invalid feeding reminder settings/i);
    expect(() => sqlite.prepare(`UPDATE app_settings SET feeding_reminder_minutes=1441`).run())
      .toThrow(/invalid feeding reminder settings/i);
    expect(() => sqlite.prepare(`UPDATE app_settings SET scheduled_notification_id='id'`).run())
      .toThrow(/invalid feeding reminder settings/i);
    expect(() => sqlite.prepare(`UPDATE app_settings SET scheduled_notification_id='id',
      feeding_reminder_scheduled_for_ms=100, feeding_reminder_source_record_id='feeding'`).run())
      .not.toThrow();
    expect(() => sqlite.prepare(`UPDATE app_settings SET feeding_reminder_minutes=NULL`).run())
      .toThrow(/invalid feeding reminder settings/i);
    sqlite.close();
  });

  test('is idempotent on repeated startup', async () => {
    const sqlite = createV6Fixture();
    const database = adapter(sqlite);
    await runMigrations(database, { targetVersion: 7 });
    await runMigrations(database, { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(sqlite.prepare(`SELECT COUNT(*) count FROM sqlite_schema
      WHERE name LIKE 'app_settings_feeding_reminder_%_valid'`).get()).toEqual({ count: 2 });
    sqlite.close();
  });
});
