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

function createV5Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.filter((item) => item.version <= 5)) sqlite.exec(migration.sql);
  sqlite.exec('PRAGMA user_version = 5');
  const hash = (digit: string) => digit.repeat(64);
  const base = `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms`;
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml)
    VALUES ('feeding', 'request-feeding', ?, 'feeding', 1, '1970-01-01', 1, 1, 1, 'formula', 60)`).run(hash('1'));
  sqlite.prepare(`INSERT INTO records (${base}, poop_color, photo_uri)
    VALUES ('poop', 'request-poop', ?, 'poop', 2, '1970-01-01', 2, 2, 2, 'yellow', 'poop-photos/kept.jpg')`).run(hash('2'));
  sqlite.prepare(`INSERT INTO records (${base}, pee_amount)
    VALUES ('pee', 'request-pee', ?, 'pee', 3, '1970-01-01', 3, 3, 3, 'small')`).run(hash('3'));
  sqlite.prepare(`INSERT INTO records (${base}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES ('sleep', 'request-sleep', ?, 'sleep', 4, '1970-01-01', 4, 4, 4, 4, 5, 'completed')`).run(hash('4'));
  return sqlite;
}

describe('other semantic migration v6', () => {
  test('upgrades v5 without losing existing records, photo paths, sleep objects, or integrity', async () => {
    const sqlite = createV5Fixture();
    await runMigrations(adapter(sqlite), { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(sqlite.prepare('SELECT id, type FROM records ORDER BY id').all()).toHaveLength(4);
    expect(sqlite.prepare(`SELECT photo_uri FROM records WHERE id='poop'`).get())
      .toEqual({ photo_uri: 'poop-photos/kept.jpg' });
    expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE name='records_sleep_update_valid'`).get())
      .toEqual({ name: 'records_sleep_update_valid' });
    expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE name='records_one_sleeping_unique'`).get())
      .toEqual({ name: 'records_one_sleeping_unique' });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test('enforces title semantics and isolates Other fields in both directions', async () => {
    const sqlite = createV5Fixture();
    await runMigrations(adapter(sqlite));
    const insertOther = (id: string, title: string | null, extraColumn = '', extraValue: Value = null) =>
      sqlite.prepare(`INSERT INTO records (
        id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
        sort_time_ms, created_at_ms, updated_at_ms, other_title${extraColumn ? `, ${extraColumn}` : ''}
      ) VALUES (?, ?, ?, 'other', 10, '1970-01-01', 10, 10, 10, ?${extraColumn ? ', ?' : ''})`).run(
        id, `request-${id}`, '9'.repeat(64), title, ...(extraColumn ? [extraValue] : []),
      );
    expect(() => insertOther('null', null)).toThrow(/invalid other fields/i);
    expect(() => insertOther('blank', '   ')).toThrow(/invalid other fields/i);
    expect(() => insertOther('long', 'x'.repeat(31))).toThrow(/invalid other fields/i);
    expect(() => insertOther('feeding-field', '洗澡', 'milk_amount_ml', 60)).toThrow();
    expect(() => insertOther('photo-field', '洗澡', 'photo_uri', 'poop-photos/bad.jpg')).toThrow();
    expect(() => sqlite.prepare(`UPDATE records SET other_title='洗澡' WHERE id='feeding'`).run()).toThrow();
    expect(() => insertOther('valid', '洗澡')).not.toThrow();
    expect(() => sqlite.prepare(`UPDATE records SET other_title=' ' WHERE id='valid'`).run())
      .toThrow(/invalid other fields/i);
    sqlite.close();
  });

  test('does not reapply v6 on repeated startup', async () => {
    const sqlite = createV5Fixture();
    const database = adapter(sqlite);
    await runMigrations(database, { targetVersion: 7 });
    await runMigrations(database, { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE name LIKE 'records_other_%'`).get()).toEqual({ count: 2 });
    sqlite.close();
  });
});
