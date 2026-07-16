/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';

describe('pee migration upgrade', () => {
  test('upgrades v3 without rebuilding records or losing feeding and poop rows', async () => {
    const sqlite = new DatabaseSync(':memory:');
    for (const migration of MIGRATIONS.filter((item) => item.version <= 3)) sqlite.exec(migration.sql);
    sqlite.exec('PRAGMA user_version = 3');
    sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, feeding_type, milk_amount_ml
    ) VALUES (?, ?, ?, 'feeding', ?, '2026-07-11', ?, ?, ?, 'formula', 60)`).run(
      'feeding-1', 'feeding-request', 'a'.repeat(64), 1, 1, 1, 1,
    );
    sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, poop_color, photo_uri
    ) VALUES (?, ?, ?, 'poop', ?, '2026-07-11', ?, ?, ?, 'yellow', 'poop-photos/existing.jpg')`).run(
      'poop-1', 'poop-request', 'b'.repeat(64), 2, 2, 2, 2,
    );

    const database: MigrationDatabase = {
      getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
        (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      withExclusiveTransactionAsync: async (task) => task({
        execAsync: async (sql) => { sqlite.exec(sql); },
        getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
          (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
        getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) => sqlite.prepare(sql).all(...params) as T[],
        runAsync: async (sql, ...params) => sqlite.prepare(sql).run(...params),
      }),
    };
    await runMigrations(database);

    expect((sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(MIGRATIONS.at(-1)?.version);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM records').get() as { count: number }).count).toBe(2);
    expect(sqlite.prepare('SELECT photo_uri FROM records WHERE id = ?').get('poop-1'))
      .toEqual({ photo_uri: 'poop-photos/existing.jpg' });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'records_pee_%'").all())
      .toHaveLength(2);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='records_one_sleeping_unique'").get())
      .toEqual({ name: 'records_one_sleeping_unique' });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='records_poop_insert_valid'").get())
      .toEqual({ name: 'records_poop_insert_valid' });
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, pee_amount, milk_amount_ml
    ) VALUES ('bad-pee', 'bad-request', ?, 'pee', 3, '2026-07-11', 3, 3, 3, 'small', 30)`).run('c'.repeat(64)))
      .toThrow(/invalid pee fields/i);
    sqlite.close();
  });
});
