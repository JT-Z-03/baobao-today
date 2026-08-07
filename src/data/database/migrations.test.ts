/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, runMigrations, type MigrationDatabase } from './migrations';

describe('SQLite migration contract', () => {
  const initialSql = MIGRATIONS[0]?.sql ?? '';
  const feedingSql = MIGRATIONS[1]?.sql ?? '';
  const poopSql = MIGRATIONS[2]?.sql ?? '';
  const peeSql = MIGRATIONS[3]?.sql ?? '';

  test('ends at schema version nine', () => {
    expect(MIGRATIONS.at(-1)?.version).toBe(9);
  });

  test('requires complete idempotency metadata for every record', () => {
    expect(initialSql).toMatch(/client_request_id\s+TEXT\s+NOT NULL\s+UNIQUE/i);
    expect(initialSql).toMatch(/create_payload_hash\s+TEXT\s+NOT NULL/i);
  });

  test('enforces one in-progress sleep with a partial unique index', () => {
    expect(initialSql).toMatch(
      /CREATE UNIQUE INDEX records_one_sleeping_unique[\s\S]*WHERE type = 'sleep' AND sleep_status = 'sleeping'/i,
    );
  });

  test('does not add cloud synchronization fields', () => {
    expect(initialSql).not.toMatch(/sync_status|server_version|remote_id|conflict_version/i);
  });

  test('adds feeding semantic constraints and a latest-record index', () => {
    expect(feedingSql).toMatch(/CREATE INDEX records_type_sort_index/i);
    expect(feedingSql).toMatch(/CREATE TRIGGER records_feeding_insert_valid/i);
    expect(feedingSql).toMatch(/CREATE TRIGGER records_feeding_update_valid/i);
    expect(feedingSql).toMatch(/left_duration_min BETWEEN 0 AND 180/i);
  });

  test('adds poop semantic constraints without rebuilding the records table', () => {
    expect(poopSql).toMatch(/CREATE TRIGGER records_poop_insert_valid/i);
    expect(poopSql).toMatch(/CREATE TRIGGER records_poop_update_valid/i);
    expect(poopSql).toMatch(/poop-photos/i);
    expect(poopSql).not.toMatch(/DROP TABLE|ALTER TABLE|CREATE TABLE records/i);
  });

  test('adds pee semantic constraints without rebuilding the records table', () => {
    expect(peeSql).toMatch(/CREATE TRIGGER records_pee_insert_valid/i);
    expect(peeSql).toMatch(/CREATE TRIGGER records_pee_update_valid/i);
    expect(peeSql).not.toMatch(/DROP TABLE|ALTER TABLE|CREATE TABLE records/i);
  });

  test('applies pending migrations once in version order', async () => {
    const sqlite = new DatabaseSync(':memory:');
    type Value = string | number | null;
    const query = {
      execAsync: async (sql: string) => { sqlite.exec(sql); },
      getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
        (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      getAllAsync: async <T,>(sql: string, ...params: Value[]) =>
        sqlite.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
    };
    let transactionCount = 0;
    const database: MigrationDatabase = {
      getFirstAsync: query.getFirstAsync,
      withExclusiveTransactionAsync: async (task) => {
        transactionCount += 1;
        sqlite.exec('BEGIN IMMEDIATE');
        try { await task(query); sqlite.exec('COMMIT'); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };

    await runMigrations(database, { targetVersion: 7 });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    const versionSevenTransactionCount = transactionCount;
    await runMigrations(database);
    const firstRunCount = transactionCount;
    await runMigrations(database);

    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.at(-1)?.version });
    expect(firstRunCount).toBeGreaterThan(0);
    expect(firstRunCount).toBe(versionSevenTransactionCount + 2);
    expect(transactionCount).toBe(firstRunCount);
    sqlite.close();
  });
});
