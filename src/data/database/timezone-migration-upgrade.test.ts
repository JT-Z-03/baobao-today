/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';
import { RECORD_COLUMNS_SQL, RECORDS_FINAL_OBJECT_NAMES, RECORDS_V6_OBJECT_NAMES } from './records-schema';

type Value = string | number | null;

function queryAdapter(sqlite: InstanceType<typeof DatabaseSync>) {
  return {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
}

function adapter(sqlite: InstanceType<typeof DatabaseSync>): MigrationDatabase {
  const query = queryAdapter(sqlite);
  return {
    getFirstAsync: query.getFirstAsync,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

function createV7Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.filter((item) => item.version <= 7)) sqlite.exec(migration.sql);
  sqlite.exec('PRAGMA user_version = 7');
  const hash = (digit: string) => digit.repeat(64);
  const rows: { sql: string; params: Value[] }[] = [
    { sql: `INSERT INTO records (id, client_request_id, create_payload_hash, type, event_time_ms,
      record_date, sort_time_ms, created_at_ms, updated_at_ms, feeding_type, milk_amount_ml)
      VALUES ('feeding', 'request-feeding', ?, 'feeding', 1, '1970-01-01', 1, 1, 1, 'formula', 60)`, params: [hash('1')] },
    { sql: `INSERT INTO records (id, client_request_id, create_payload_hash, type, event_time_ms,
      record_date, sort_time_ms, created_at_ms, updated_at_ms, poop_color)
      VALUES ('poop', 'request-poop', ?, 'poop', 2, '1970-01-01', 2, 2, 2, 'yellow')`, params: [hash('2')] },
    { sql: `INSERT INTO records (id, client_request_id, create_payload_hash, type, event_time_ms,
      record_date, sort_time_ms, created_at_ms, updated_at_ms, pee_amount)
      VALUES ('pee', 'request-pee', ?, 'pee', 3, '1970-01-01', 3, 3, 3, 'small')`, params: [hash('3')] },
    { sql: `INSERT INTO records (id, client_request_id, create_payload_hash, type, event_time_ms,
      record_date, sort_time_ms, created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status)
      VALUES ('sleep', 'request-sleep', ?, 'sleep', 4, '1970-01-01', 4, 4, 4, 4, 5, 'completed')`, params: [hash('4')] },
    { sql: `INSERT INTO records (id, client_request_id, create_payload_hash, type, event_time_ms,
      record_date, sort_time_ms, created_at_ms, updated_at_ms, other_title)
      VALUES ('other', 'request-other', ?, 'other', 5, '1970-01-01', 5, 5, 5, '洗澡')`, params: [hash('5')] },
  ];
  for (const row of rows) sqlite.prepare(row.sql).run(...row.params);
  return sqlite;
}

function snapshotRecords(sqlite: InstanceType<typeof DatabaseSync>) {
  return sqlite.prepare(`SELECT ${RECORD_COLUMNS_SQL} FROM records ORDER BY id`).all();
}

function insertHistoricalSleep(sqlite: InstanceType<typeof DatabaseSync>, overrides = '') {
  const columns = `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status`;
  const values = `'historical-sleep', 'historical-request', '${'9'.repeat(64)}', 'sleep',
    18000000, '1969-12-31', 18000000, 10, 10, 18000000, 21600000, 'completed'`;
  sqlite.exec(`INSERT INTO records (${columns}) VALUES (${overrides || values})`);
}

describe('historical local record date migration v8', () => {
  test('upgrades v7 without rebuilding records or changing any business value', async () => {
    const sqlite = createV7Fixture();
    const before = snapshotRecords(sqlite);
    await runMigrations(adapter(sqlite), { targetVersion: 8 });

    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(snapshotRecords(sqlite)).toEqual(before);
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    const names = new Set((sqlite.prepare(`SELECT name FROM sqlite_schema
      WHERE tbl_name='records' AND type IN ('index','trigger')`).all() as { name: string }[]).map((row) => row.name));
    for (const name of [...RECORDS_FINAL_OBJECT_NAMES, ...RECORDS_V6_OBJECT_NAMES]) expect(names).toContain(name);
    const sleepTriggerSql = (sqlite.prepare(`SELECT group_concat(sql, '\n') sql FROM sqlite_schema
      WHERE name IN ('records_sleep_insert_valid','records_sleep_update_valid')`).get() as { sql: string }).sql;
    expect(sleepTriggerSql).not.toMatch(/strftime|localtime/i);
    sqlite.close();
  });

  test('accepts a historical sleep date that differs from the current timezone calculation', async () => {
    const sqlite = createV7Fixture();
    await runMigrations(adapter(sqlite), { targetVersion: 8 });
    insertHistoricalSleep(sqlite);
    expect(sqlite.prepare(`SELECT record_date, event_time_ms, sort_time_ms, sleep_start_ms
      FROM records WHERE id='historical-sleep'`).get()).toEqual({
      record_date: '1969-12-31', event_time_ms: 18000000, sort_time_ms: 18000000, sleep_start_ms: 18000000,
    });
    sqlite.close();
  });

  test.each([
    ['sleeping with end', `'bad', 'bad-request-1', '${'a'.repeat(64)}', 'sleep', 10, '2026-01-01', 10, 1, 1, 10, 11, 'sleeping'`],
    ['completed without end', `'bad', 'bad-request-2', '${'b'.repeat(64)}', 'sleep', 10, '2026-01-01', 10, 1, 1, 10, NULL, 'completed'`],
    ['end not after start', `'bad', 'bad-request-3', '${'c'.repeat(64)}', 'sleep', 10, '2026-01-01', 10, 1, 1, 10, 10, 'completed'`],
    ['event differs from start', `'bad', 'bad-request-4', '${'d'.repeat(64)}', 'sleep', 9, '2026-01-01', 10, 1, 1, 10, 11, 'completed'`],
    ['sort differs from start', `'bad', 'bad-request-5', '${'e'.repeat(64)}', 'sleep', 10, '2026-01-01', 9, 1, 1, 10, 11, 'completed'`],
  ])('still rejects %s', async (_label, values) => {
    const sqlite = createV7Fixture();
    await runMigrations(adapter(sqlite), { targetVersion: 8 });
    expect(() => insertHistoricalSleep(sqlite, values)).toThrow(/invalid sleep fields/i);
    sqlite.close();
  });

  test('continues to enforce one sleeping record and field isolation', async () => {
    const sqlite = createV7Fixture();
    await runMigrations(adapter(sqlite), { targetVersion: 8 });
    const base = `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
      sort_time_ms, created_at_ms, updated_at_ms, sleep_start_ms, sleep_end_ms, sleep_status`;
    sqlite.exec(`INSERT INTO records (${base}) VALUES ('active-1','active-request-1','${'6'.repeat(64)}',
      'sleep',10,'2026-01-01',10,1,1,10,NULL,'sleeping')`);
    expect(() => sqlite.exec(`INSERT INTO records (${base}) VALUES ('active-2','active-request-2','${'7'.repeat(64)}',
      'sleep',11,'2026-01-01',11,1,1,11,NULL,'sleeping')`)).toThrow(/UNIQUE constraint/i);
    expect(() => sqlite.exec(`INSERT INTO records (${base}, milk_amount_ml) VALUES
      ('mixed-fields','mixed-request','${'8'.repeat(64)}','sleep',12,'2026-01-01',12,1,1,12,13,'completed',30)`))
      .toThrow(/invalid sleep fields/i);
    sqlite.close();
  });

  test.each(['after-v8-trigger-drop', 'after-v8-trigger-create'] as const)(
    'rolls back data, triggers, and version when failure is injected at %s',
    async (failurePoint) => {
      const sqlite = createV7Fixture();
      const before = snapshotRecords(sqlite);
      const triggerBefore = sqlite.prepare(`SELECT name, sql FROM sqlite_schema
        WHERE name LIKE 'records_sleep_%_valid' ORDER BY name`).all();
      await expect(runMigrations(adapter(sqlite), { failurePoint: failurePoint as never, targetVersion: 8 }))
        .rejects.toThrow(/Injected/);
      expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
      expect(snapshotRecords(sqlite)).toEqual(before);
      expect(sqlite.prepare(`SELECT name, sql FROM sqlite_schema
        WHERE name LIKE 'records_sleep_%_valid' ORDER BY name`).all()).toEqual(triggerBefore);
      sqlite.close();
    },
  );
});
