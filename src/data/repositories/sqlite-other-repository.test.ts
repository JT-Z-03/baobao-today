/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import type { OtherCoreInput } from '@/domain/other/other';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

import { SQLiteOtherRepository, type OtherDatabase } from './sqlite-other-repository';

type Value = string | number | null;

function createDatabaseAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  const database: OtherDatabase = {
    ...query,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, database };
}

function hashStub() {
  const values = new Map<string, string>();
  return async (payload: string) => {
    if (!values.has(payload)) values.set(payload, String(values.size + 1).repeat(64));
    return values.get(payload)!;
  };
}

const july11 = new Date(2026, 6, 11, 10, 30).getTime();
const input = (overrides: Partial<OtherCoreInput> = {}): OtherCoreInput => ({
  eventTimeMs: july11,
  title: '洗澡',
  note: null,
  ...overrides,
});

describe('SQLiteOtherRepository host SQLite integration', () => {
  let sqlite: InstanceType<typeof DatabaseSync>;
  let repository: SQLiteOtherRepository;

  beforeEach(() => {
    const setup = createDatabaseAdapter();
    sqlite = setup.sqlite;
    repository = new SQLiteOtherRepository(setup.database, hashStub());
  });
  afterEach(() => sqlite.close());

  test('creates normalized Other records with repository-derived fields', async () => {
    await expect(repository.create({
      id: 'other-1', clientRequestId: 'request-1', nowMs: july11,
      input: input({ title: '  洗澡  ', note: '  水温合适  ' }),
    })).resolves.toMatchObject({
      id: 'other-1', type: 'other', title: '洗澡', note: '水温合适',
      eventTimeMs: july11, recordDate: '2026-07-11', sortTimeMs: july11,
    });
    expect(sqlite.prepare(`SELECT other_title, feeding_type, photo_uri, sleep_status
      FROM records WHERE id='other-1'`).get()).toEqual({
      other_title: '洗澡', feeding_type: null, photo_uri: null, sleep_status: null,
    });
  });

  test('returns the same record for one normalized payload and conflicts on a different payload', async () => {
    const command = { id: 'other-1', clientRequestId: 'request-1', nowMs: july11, input: input() };
    const first = await repository.create(command);
    await expect(repository.create({ ...command, id: 'ignored', input: input({ title: ' 洗澡 ' }) }))
      .resolves.toEqual(first);
    await expect(repository.create({ ...command, id: 'conflict', input: input({ title: '晒太阳' }) }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('updates only typed fields, clears note, and moves derived date fields', async () => {
    await repository.create({
      id: 'other-1', clientRequestId: 'request-1', nowMs: july11,
      input: input({ note: '原备注' }),
    });
    const july10 = new Date(2026, 6, 10, 23, 0).getTime();
    const updated = await repository.update('other-1', {
      eventTimeMs: july10,
      title: '  剪  指甲 ',
      note: ' ',
      type: 'feeding',
      milkAmountMl: 90,
      photoUri: 'poop-photos/bad.jpg',
      sleepStatus: 'completed',
    } as never, july11);
    expect(updated).toMatchObject({
      type: 'other', title: '剪  指甲', note: null,
      recordDate: '2026-07-10', sortTimeMs: july10,
    });
    expect(sqlite.prepare(`SELECT type, other_title, milk_amount_ml, photo_uri, sleep_status
      FROM records WHERE id='other-1'`).get()).toEqual({
      type: 'other', other_title: '剪  指甲', milk_amount_ml: null, photo_uri: null, sleep_status: null,
    });
    await expect(repository.listByDate('2026-07-11')).resolves.toEqual([]);
    await expect(repository.listByDate('2026-07-10')).resolves.toEqual([updated]);
  });

  test('rejects another record type and all cross-type fields at the database boundary', () => {
    const hash = '8'.repeat(64);
    const base = `id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
      sort_time_ms, created_at_ms, updated_at_ms, other_title`;
    for (const [column, value] of [
      ['milk_amount_ml', 60], ['poop_color', 'yellow'], ['pee_amount', 'small'],
      ['sleep_start_ms', 1], ['photo_uri', 'poop-photos/bad.jpg'],
    ] as const) {
      expect(() => sqlite.prepare(`INSERT INTO records (${base}, ${column})
        VALUES (?, ?, ?, 'other', 1, '1970-01-01', 1, 1, 1, '洗澡', ?)`).run(
          `bad-${column}`, `request-${column}`, hash, value,
        )).toThrow();
    }
    expect(() => sqlite.prepare(`INSERT INTO records (
      id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
      sort_time_ms, created_at_ms, updated_at_ms, feeding_type, milk_amount_ml, other_title
    ) VALUES ('feeding', 'feeding-request', ?, 'feeding', 2, '1970-01-01', 2, 2, 2,
      'formula', 60, '洗澡')`).run(hash)).toThrow(/invalid other fields/i);
  });

  test('queries by date in descending order and removes a deleted record', async () => {
    await repository.create({ id: 'early', clientRequestId: 'request-1', nowMs: july11, input: input() });
    await repository.create({
      id: 'late', clientRequestId: 'request-2', nowMs: july11 + 1,
      input: input({ eventTimeMs: july11 + 1, title: '打嗝' }),
    });
    await expect(repository.listByDate('2026-07-11')).resolves.toMatchObject([
      { id: 'late' }, { id: 'early' },
    ]);
    await repository.delete('late');
    await expect(repository.getById('late')).resolves.toBeNull();
    await expect(repository.listByDate('2026-07-11')).resolves.toMatchObject([{ id: 'early' }]);
  });
});
