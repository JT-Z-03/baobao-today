/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';
import { RECORD_COLUMNS_SQL } from './records-schema';

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

function createV8Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.filter((item) => item.version <= 8)) sqlite.exec(migration.sql);
  sqlite.exec('PRAGMA user_version = 8');
  const base = `id, client_request_id, create_payload_hash, type, event_time_ms,
    record_date, sort_time_ms, created_at_ms, updated_at_ms`;
  sqlite.prepare(`INSERT INTO records (${base}, note, feeding_type, milk_amount_ml)
    VALUES ('formula', 'request-formula', ?, 'feeding', 1, '1970-01-01', 1, 1, 1, 'kept', 'formula', 60)`)
    .run('1'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, left_duration_min, right_duration_min)
    VALUES ('breast', 'request-breast', ?, 'feeding', 2, '1970-01-01', 2, 2, 2, 'breast', 12, 0)`)
    .run('2'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, feeding_type, milk_amount_ml, left_duration_min, right_duration_min)
    VALUES ('mixed', 'request-mixed', ?, 'feeding', 3, '1970-01-01', 3, 3, 3, 'mixed', 40, 8, 0)`)
    .run('3'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, poop_color, poop_texture, poop_amount, photo_uri)
    VALUES ('poop', 'request-poop', ?, 'poop', 4, '1970-01-01', 4, 4, 4,
      'yellow', 'pasty', 'medium', 'poop-photos/kept.jpg')`)
    .run('4'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, pee_color, pee_amount)
    VALUES ('pee', 'request-pee', ?, 'pee', 5, '1970-01-01', 5, 5, 5, 'pale-yellow', 'small')`)
    .run('5'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, sleep_start_ms, sleep_end_ms, sleep_status)
    VALUES ('sleep', 'request-sleep', ?, 'sleep', 6, '1969-12-31', 6, 6, 6, 6, 7, 'completed')`)
    .run('6'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base}, other_title)
    VALUES ('other', 'request-other', ?, 'other', 8, '1970-01-01', 8, 8, 8, '洗澡')`)
    .run('7'.repeat(64));
  return sqlite;
}

function insertFeeding(
  sqlite: InstanceType<typeof DatabaseSync>,
  feedingType: string,
  formula: number | null,
  breastMilk: number | null,
  left: number | null,
  right: number | null,
) {
  return sqlite.prepare(`INSERT INTO records (
    id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms, feeding_type, milk_amount_ml,
    breast_milk_amount_ml, left_duration_min, right_duration_min
  ) VALUES (?, ?, ?, 'feeding', 10, '1970-01-01', 10, 10, 10, ?, ?, ?, ?, ?)`)
    .run(
      'feeding-probe',
      'request-feeding-probe',
      '9'.repeat(64),
      feedingType,
      formula,
      breastMilk,
      left,
      right,
    );
}

describe('bottled breast milk feeding migration v9', () => {
  test('upgrades v8 records without rewriting historical feeding semantics', async () => {
    const sqlite = createV8Fixture();
    const before = sqlite.prepare(`SELECT id, feeding_type, milk_amount_ml,
      left_duration_min, right_duration_min FROM records ORDER BY id`).all();
    const allValuesBefore = sqlite.prepare(`SELECT ${RECORD_COLUMNS_SQL} FROM records ORDER BY id`).all();

    await runMigrations(adapter(sqlite));

    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
    expect(sqlite.prepare(`SELECT id, feeding_type, milk_amount_ml,
      left_duration_min, right_duration_min FROM records ORDER BY id`).all()).toEqual(before);
    expect(sqlite.prepare(`SELECT ${RECORD_COLUMNS_SQL} FROM records ORDER BY id`).all()).toEqual(allValuesBefore);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM records
      WHERE breast_milk_amount_ml IS NOT NULL`).get()).toEqual({ count: 0 });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test.each([
    ['bottle', 'bottle_breast', null, 80, null, null],
    ['direct+bottle', 'mixed', null, 80, 10, 0],
    ['direct+formula', 'mixed', 40, null, 10, 0],
    ['bottle+formula', 'mixed', 40, 80, null, null],
    ['all', 'mixed', 40, 80, 10, 0],
  ] as const)('accepts %s', async (_label, feedingType, formula, breastMilk, left, right) => {
    const sqlite = createV8Fixture();
    await runMigrations(adapter(sqlite));
    expect(() => insertFeeding(sqlite, feedingType, formula, breastMilk, left, right)).not.toThrow();
    sqlite.close();
  });

  test.each([
    ['formula with bottled milk', 'formula', 40, 80, null, null],
    ['bottle with formula', 'bottle_breast', 40, 80, null, null],
    ['mixed formula only', 'mixed', 40, null, null, null],
    ['mixed bottled only', 'mixed', null, 80, null, null],
    ['mixed direct only', 'mixed', null, null, 10, 0],
  ] as const)('rejects %s', async (_label, feedingType, formula, breastMilk, left, right) => {
    const sqlite = createV8Fixture();
    await runMigrations(adapter(sqlite));
    expect(() => insertFeeding(sqlite, feedingType, formula, breastMilk, left, right))
      .toThrow(/invalid feeding fields/i);
    sqlite.close();
  });

  test.each([
    'after-v9-copy',
    'after-v9-drop',
    'after-v9-schema-objects',
    'after-v9-version',
  ] as const)('rolls back schema, objects, data, and version at %s', async (failurePoint) => {
    const sqlite = createV8Fixture();
    const recordsBefore = sqlite.prepare(`SELECT ${RECORD_COLUMNS_SQL} FROM records ORDER BY id`).all();
    const objectsBefore = sqlite.prepare(`SELECT name, type, sql FROM sqlite_schema
      WHERE tbl_name='records' AND type IN ('index','trigger') AND sql IS NOT NULL
      ORDER BY name`).all();
    await expect(runMigrations(adapter(sqlite), { failurePoint })).rejects.toThrow(/Injected/);
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(sqlite.prepare(`SELECT ${RECORD_COLUMNS_SQL} FROM records ORDER BY id`).all()).toEqual(recordsBefore);
    expect(sqlite.prepare(`SELECT name, type, sql FROM sqlite_schema
      WHERE tbl_name='records' AND type IN ('index','trigger') AND sql IS NOT NULL
      ORDER BY name`).all()).toEqual(objectsBefore);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('records')
      WHERE name='breast_milk_amount_ml'`).get()).toEqual({ count: 0 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='records_v9'`).get()).toEqual({ count: 0 });
    sqlite.close();
  });
});
