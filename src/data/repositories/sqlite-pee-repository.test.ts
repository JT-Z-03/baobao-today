/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import type { PeeCoreInput } from '@/domain/pee/pee';

import {
  IdempotencyConflictError,
  SQLitePeeRepository,
  type PeeDatabase,
} from './sqlite-pee-repository';

function createDatabaseAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: (string | number | null)[]) => sqlite.prepare(sql).run(...params),
  };
  const database: PeeDatabase = {
    ...query,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, database };
}

function createHashStub() {
  const hashes = new Map<string, string>();
  return async (payload: string) => {
    if (!hashes.has(payload)) hashes.set(payload, ((hashes.size + 1) % 10).toString().repeat(64));
    return hashes.get(payload)!;
  };
}

const july11 = new Date(2026, 6, 11, 8, 0).getTime();
function peeInput(overrides: Partial<PeeCoreInput> = {}): PeeCoreInput {
  return { eventTimeMs: july11, amount: null, color: null, note: null, ...overrides };
}

describe('SQLitePeeRepository host SQLite integration', () => {
  let sqlite: InstanceType<typeof DatabaseSync>;
  let repository: SQLitePeeRepository;

  beforeEach(() => {
    const setup = createDatabaseAdapter();
    sqlite = setup.sqlite;
    repository = new SQLitePeeRepository(setup.database, createHashStub());
  });
  afterEach(() => sqlite.close());

  test('creates time-only and classified pee records with repository-derived fields', async () => {
    const empty = await repository.create({ id: 'pee-1', clientRequestId: 'request-1', input: peeInput(), nowMs: july11 });
    const classified = await repository.create({
      id: 'pee-2', clientRequestId: 'request-2',
      input: peeInput({ eventTimeMs: july11 + 1, amount: 'medium', color: 'light_yellow' }), nowMs: july11 + 1,
    });
    expect(empty).toMatchObject({ type: 'pee', recordDate: '2026-07-11', amount: null, color: null });
    expect(classified).toMatchObject({ amount: 'medium', color: 'light_yellow' });
    expect(sqlite.prepare('SELECT pee_color FROM records WHERE id = ?').get('pee-2')).toEqual({ pee_color: 'pale-yellow' });
    await expect(repository.listByDate('2026-07-11')).resolves.toEqual([classified, empty]);
    await expect(repository.getDailyCount('2026-07-11')).resolves.toBe(2);
  });

  test('returns the same payload and rejects a different payload for one request id', async () => {
    const command = { id: 'pee-1', clientRequestId: 'request-1', input: peeInput(), nowMs: july11 };
    const first = await repository.create(command);
    await expect(repository.create({ ...command, id: 'ignored' })).resolves.toEqual(first);
    await expect(repository.create({ ...command, id: 'conflict', input: peeInput({ amount: 'small' }) }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('updates only typed pee fields, clears optional values, and re-derives date', async () => {
    await repository.create({
      id: 'pee-1', clientRequestId: 'request-1',
      input: peeInput({ amount: 'medium', color: 'dark_yellow' }), nowMs: july11,
    });
    const moved = new Date(2026, 6, 10, 23, 0).getTime();
    const updated = await repository.update('pee-1', {
      ...peeInput({ eventTimeMs: moved }),
      type: 'feeding', milkAmountMl: 90, poopColor: 'yellow',
    } as unknown as Parameters<SQLitePeeRepository['update']>[1], july11 + 1);
    expect(updated).toMatchObject({
      type: 'pee', recordDate: '2026-07-10', sortTimeMs: moved, amount: null, color: null,
    });
    expect(sqlite.prepare(`SELECT feeding_type, milk_amount_ml, poop_color, photo_uri, pee_amount, pee_color
      FROM records WHERE id = ?`).get('pee-1')).toEqual({
        feeding_type: null, milk_amount_ml: null, poop_color: null, photo_uri: null,
        pee_amount: null, pee_color: null,
      });
  });

  test('moves statistics across dates, excludes other types, and decrements after delete', async () => {
    await repository.create({ id: 'pee-1', clientRequestId: 'request-1', input: peeInput(), nowMs: july11 });
    sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, poop_color
    ) VALUES ('poop-1', 'poop-request', ?, 'poop', ?, '2026-07-11', ?, ?, ?, 'yellow')`)
      .run('a'.repeat(64), july11 + 2, july11 + 2, july11 + 2, july11 + 2);
    expect(await repository.getDailyCount('2026-07-11')).toBe(1);

    const moved = new Date(2026, 6, 10, 23, 0).getTime();
    await repository.update('pee-1', peeInput({ eventTimeMs: moved }), july11 + 3);
    expect(await repository.getDailyCount('2026-07-11')).toBe(0);
    expect(await repository.getDailyCount('2026-07-10')).toBe(1);
    await repository.delete('pee-1');
    await expect(repository.getById('pee-1')).resolves.toBeNull();
    expect(await repository.getDailyCount('2026-07-10')).toBe(0);
  });

  test('database triggers reject pee fields on another type and another-type fields on pee', () => {
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, pee_amount, milk_amount_ml
    ) VALUES ('bad-pee', 'bad-request', ?, 'pee', 1, '2026-07-11', 1, 1, 1, 'small', 60)`).run('a'.repeat(64)))
      .toThrow(/invalid pee fields/i);
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms, feeding_type, milk_amount_ml, pee_color
    ) VALUES ('bad-feeding', 'bad-feeding-request', ?, 'feeding', 2, '2026-07-11', 2, 2, 2, 'formula', 60, 'clear')`).run('b'.repeat(64)))
      .toThrow(/invalid pee fields/i);
  });
});
