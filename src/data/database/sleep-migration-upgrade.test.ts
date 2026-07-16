/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { toLocalDateKey } from '@/domain/date/local-date';

import {
  MIGRATIONS,
  runMigrations,
  type MigrationDatabase,
  type MigrationFailurePoint,
} from './migrations';

type Value = string | number | null;

function adapter(sqlite: InstanceType<typeof DatabaseSync>): MigrationDatabase {
  const query = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) =>
      sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  return {
    getFirstAsync: query.getFirstAsync,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        await task(query);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function createV4Database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.filter((item) => item.version <= 4)) sqlite.exec(migration.sql);
  sqlite.exec('PRAGMA user_version = 4');
  return sqlite;
}

const hash = (digit: number) => String(digit).repeat(64);
const july10 = new Date(2026, 6, 10, 8, 0).getTime();
const sleepStart = new Date(2026, 6, 10, 23, 0).getTime();
const sleepEnd = new Date(2026, 6, 11, 2, 0).getTime();

function insertAllRecordTypes(sqlite: InstanceType<typeof DatabaseSync>) {
  const base = `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms, note`;
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml, left_duration_min, right_duration_min)
    VALUES (?, ?, ?, 'feeding', ?, ?, ?, ?, ?, ?, 'formula', 60, NULL, NULL)`).run(
    'formula', 'request-formula', hash(1), july10, '2026-07-10', july10, 1, 2, 'formula note',
  );
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml, left_duration_min, right_duration_min)
    VALUES (?, ?, ?, 'feeding', ?, ?, ?, ?, ?, NULL, 'breast', NULL, 10, 0)`).run(
    'breast', 'request-breast', hash(2), july10 + 1, '2026-07-10', july10 + 1, 3, 4,
  );
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml, left_duration_min, right_duration_min)
    VALUES (?, ?, ?, 'feeding', ?, ?, ?, ?, ?, NULL, 'mixed', 30, 5, 0)`).run(
    'mixed', 'request-mixed', hash(3), july10 + 2, '2026-07-10', july10 + 2, 5, 6,
  );
  sqlite.prepare(`INSERT INTO records (${base}, poop_color, poop_texture, poop_amount, photo_uri)
    VALUES (?, ?, ?, 'poop', ?, ?, ?, ?, ?, NULL, 'yellow', 'pasty', 'medium', NULL)`).run(
    'poop-plain', 'request-poop-plain', hash(4), july10 + 3, '2026-07-10', july10 + 3, 7, 8,
  );
  sqlite.prepare(`INSERT INTO records (${base}, poop_color, photo_uri)
    VALUES (?, ?, ?, 'poop', ?, ?, ?, ?, ?, ?, 'green', 'poop-photos/kept.jpg')`).run(
    'poop-photo', 'request-poop-photo', hash(5), july10 + 4, '2026-07-10', july10 + 4, 9, 10, 'photo note',
  );
  sqlite.prepare(`INSERT INTO records (${base}, pee_color, pee_amount)
    VALUES (?, ?, ?, 'pee', ?, ?, ?, ?, ?, NULL, 'pale-yellow', 'small')`).run(
    'pee', 'request-pee', hash(6), july10 + 5, '2026-07-10', july10 + 5, 11, 12,
  );
  sqlite.prepare(`INSERT INTO records (${base}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES (?, ?, ?, 'sleep', NULL, ?, ?, ?, ?, ?, ?, NULL, 'sleeping')`).run(
    'sleeping', 'request-sleeping', hash(7), toLocalDateKey(sleepStart + 24 * 60 * 60 * 1_000),
    sleepStart, 13, 14, 'active note', sleepStart,
  );
  sqlite.prepare(`INSERT INTO records (${base}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES (?, ?, ?, 'sleep', NULL, ?, ?, ?, ?, NULL, ?, ?, 'completed')`).run(
    'completed', 'request-completed', hash(8), '2000-01-01', sleepStart - 1, 15, 16,
    sleepStart - 1, sleepEnd,
  );
}

const requiredObjects = [
  'records_client_request_id_unique',
  'records_completed_sleep_interval_index',
  'records_date_sort_index',
  'records_date_type_sort_index',
  'records_feeding_insert_valid',
  'records_feeding_update_valid',
  'records_one_sleeping_unique',
  'records_pee_insert_valid',
  'records_pee_update_valid',
  'records_poop_insert_valid',
  'records_poop_update_valid',
  'records_sleep_insert_valid',
  'records_sleep_update_valid',
  'records_type_sort_index',
];

describe('records migration v5', () => {
  test('upgrades an empty v4 database and installs the final schema objects', async () => {
    const sqlite = createV4Database();
    await runMigrations(adapter(sqlite), { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    const names = sqlite.prepare(`SELECT name FROM sqlite_schema
      WHERE tbl_name='records' AND type IN ('index','trigger') ORDER BY name`).all()
      .map((row: { name: string }) => row.name);
    expect(names).toEqual(expect.arrayContaining(requiredObjects));
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test('preserves every existing business value and re-derives only sleep time fields', async () => {
    const sqlite = createV4Database();
    insertAllRecordTypes(sqlite);
    const before = sqlite.prepare(`SELECT id, client_request_id, create_payload_hash, type,
      event_time_ms, note, feeding_type, milk_amount_ml, left_duration_min, right_duration_min,
      poop_color, poop_texture, poop_amount, photo_uri, pee_color, pee_amount,
      sleep_start_ms, sleep_end_ms, sleep_status, created_at_ms, updated_at_ms
      FROM records ORDER BY id`).all();

    await runMigrations(adapter(sqlite));

    const after = sqlite.prepare(`SELECT id, client_request_id, create_payload_hash, type,
      event_time_ms, note, feeding_type, milk_amount_ml, left_duration_min, right_duration_min,
      poop_color, poop_texture, poop_amount, photo_uri, pee_color, pee_amount,
      sleep_start_ms, sleep_end_ms, sleep_status, created_at_ms, updated_at_ms
      FROM records ORDER BY id`).all();
    expect(after.map((row: { type: string; event_time_ms: number | null }) =>
      row.type === 'sleep' ? { ...row, event_time_ms: null } : row)).toEqual(before);
    expect(sqlite.prepare(`SELECT id, event_time_ms, record_date, sort_time_ms FROM records
      WHERE type='sleep' ORDER BY id`).all()).toEqual([
      { id: 'completed', event_time_ms: sleepStart - 1, record_date: toLocalDateKey(sleepStart - 1), sort_time_ms: sleepStart - 1 },
      { id: 'sleeping', event_time_ms: sleepStart, record_date: toLocalDateKey(sleepStart), sort_time_ms: sleepStart },
    ]);
    expect(sqlite.prepare(`SELECT photo_uri FROM records WHERE id='poop-photo'`).get())
      .toEqual({ photo_uri: 'poop-photos/kept.jpg' });
    sqlite.close();
  });

  test('enforces active uniqueness and final sleep semantics', async () => {
    const sqlite = createV4Database();
    await runMigrations(adapter(sqlite));
    const insert = (id: string, status: string, start: number, end: number | null, event = start) =>
      sqlite.prepare(`INSERT INTO records (
        id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
        created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status
      ) VALUES (?, ?, ?, 'sleep', ?, ?, ?, 1, 1, ?, ?, ?)`).run(
        id, `request-${id}`, hash(9), event, toLocalDateKey(start), start, start, end, status,
      );
    insert('active-1', 'sleeping', sleepStart, null);
    expect(() => insert('active-2', 'sleeping', sleepStart + 1, null)).toThrow();
    expect(() => insert('bad-active-end', 'sleeping', sleepStart + 2, sleepEnd)).toThrow();
    expect(() => insert('bad-completed-null', 'completed', sleepStart + 3, null)).toThrow();
    expect(() => insert('bad-completed-order', 'completed', sleepStart + 4, sleepStart + 4)).toThrow();
    expect(() => insert('bad-event', 'completed', sleepStart + 5, sleepEnd, sleepStart + 6)).toThrow();
    insert('completed', 'completed', sleepStart - 1, sleepEnd);
    expect(() => sqlite.prepare(`UPDATE records SET sleep_status='sleeping', sleep_end_ms=NULL
      WHERE id='completed'`).run()).toThrow(/state transition/i);
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, sleep_start_ms, sleep_status
    ) VALUES ('bad-feeding-sleep', 'request-bad-feeding-sleep', ?, 'feeding', 1, '1970-01-01', 1,
      1, 1, 1, 'sleeping')`).run(hash(4))).toThrow(/sleep fields/i);
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, sleep_start_ms, sleep_status, milk_amount_ml
    ) VALUES ('bad-sleep-feeding', 'request-bad-sleep-feeding', ?, 'sleep', 3, '1970-01-01', 3,
      3, 3, 3, 'sleeping', 60)`).run(hash(5))).toThrow(/feeding fields|sleep fields/i);
    sqlite.close();
  });

  test.each<MigrationFailurePoint>(['after-copy', 'after-drop', 'after-schema-objects'])(
    'rolls the whole rebuild back at %s',
    async (failurePoint) => {
      const sqlite = createV4Database();
      insertAllRecordTypes(sqlite);
      await expect(runMigrations(adapter(sqlite), { failurePoint })).rejects.toThrow(failurePoint);
      expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 8 });
      expect(sqlite.prepare(`SELECT event_time_ms FROM records WHERE id='sleeping'`).get())
        .toEqual({ event_time_ms: null });
      expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE name='records_v5'`).get()).toBeUndefined();
      expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE name='records_pee_insert_valid'`).get())
        .toEqual({ name: 'records_pee_insert_valid' });
      sqlite.close();
    },
  );

  test('does not rebuild or lose data after user_version is already five', async () => {
    const sqlite = createV4Database();
    insertAllRecordTypes(sqlite);
    const database = adapter(sqlite);
    await runMigrations(database);
    const rootPageBefore = sqlite.prepare(`SELECT rootpage FROM sqlite_schema WHERE name='records'`).get();
    await runMigrations(database);
    expect(sqlite.prepare(`SELECT rootpage FROM sqlite_schema WHERE name='records'`).get()).toEqual(rootPageBefore);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 8 });
    sqlite.close();
  });
});
