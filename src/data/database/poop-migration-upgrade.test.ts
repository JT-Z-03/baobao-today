/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';

describe('poop migration upgrade', () => {
  test('upgrades a stage 2A database without rebuilding records or changing feeding data', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(MIGRATIONS[0].sql);
    sqlite.exec(MIGRATIONS[1].sql);
    sqlite.exec('PRAGMA user_version = 2');
    const time = new Date(2026, 6, 11, 8, 0).getTime();
    sqlite.prepare(`
      INSERT INTO records (
        id, client_request_id, create_payload_hash, type,
        event_time_ms, record_date, sort_time_ms,
        created_at_ms, updated_at_ms, feeding_type, milk_amount_ml
      ) VALUES ('feeding-1', 'request-1', ?, 'feeding', ?, '2026-07-11', ?, ?, ?, 'formula', 60)
    `).run('a'.repeat(64), time, time, time, time);

    const database: MigrationDatabase = {
      getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
        (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      withExclusiveTransactionAsync: async (task) => {
        const query = {
          execAsync: async (sql: string) => { sqlite.exec(sql); },
          getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
            (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
          getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
            sqlite.prepare(sql).all(...params) as T[],
          runAsync: async (sql: string, ...params: (string | number | null)[]) => sqlite.prepare(sql).run(...params),
        };
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

    await runMigrations(database);
    expect(sqlite.prepare('SELECT milk_amount_ml FROM records WHERE id = ?').get('feeding-1')).toEqual({ milk_amount_ml: 60 });
    expect((sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(MIGRATIONS.at(-1)?.version);
    expect(() => sqlite.prepare('UPDATE records SET poop_color = ? WHERE id = ?').run('yellow', 'feeding-1')).toThrow();
    sqlite.close();
  });
});
