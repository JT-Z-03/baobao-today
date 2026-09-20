/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

import {
  SQLiteSleepRepository,
  SleepRecordStateError,
  type SleepDatabase,
} from './sqlite-sleep-repository';

type Value = string | number | null;

function createDatabaseAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) =>
      sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
  };
  const database: SleepDatabase = {
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

const startMs = new Date(2026, 6, 10, 23, 0).getTime();
const endMs = new Date(2026, 6, 11, 2, 0).getTime();

describe('SQLiteSleepRepository host SQLite integration', () => {
  let sqlite: InstanceType<typeof DatabaseSync>;
  let repository: SQLiteSleepRepository;

  beforeEach(() => {
    const setup = createDatabaseAdapter();
    sqlite = setup.sqlite;
    repository = new SQLiteSleepRepository(setup.database, hashStub());
  });
  afterEach(() => sqlite.close());

  test('starts a sleep with repository-derived fields and idempotent request semantics', async () => {
    const command = {
      id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs,
      input: { startMs, note: '  night  ' },
    };
    const first = await repository.start(command);
    expect(first).toMatchObject({ outcome: 'created', record: {
      id: 'sleep-1', type: 'sleep', status: 'sleeping', startMs, endMs: null,
      eventTimeMs: startMs, sortTimeMs: startMs, recordDate: '2026-07-10', note: 'night',
    } });
    await expect(repository.start({ ...command, id: 'ignored' }))
      .resolves.toMatchObject({ outcome: 'idempotent', record: { id: 'sleep-1' } });
    await expect(repository.start({ ...command, id: 'conflict', input: { startMs: startMs - 1, note: null } }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('returns the current active sleep when another request races with the unique index', async () => {
    await repository.start({ id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: null } });
    await expect(repository.start({
      id: 'sleep-2', clientRequestId: 'request-2', nowMs: startMs + 1,
      input: { startMs: startMs + 1, note: 'second intent' },
    })).resolves.toMatchObject({ outcome: 'already-active', record: { id: 'sleep-1' } });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM records WHERE sleep_status='sleeping'`).get())
      .toEqual({ count: 1 });
  });

  test('finishes atomically and repeated finish never overwrites the original end', async () => {
    await repository.start({ id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: null } });
    await expect(repository.finish('sleep-1', endMs, endMs)).resolves.toMatchObject({
      outcome: 'completed', record: { status: 'completed', endMs },
    });
    await expect(repository.finish('sleep-1', endMs + 60_000, endMs + 60_000)).resolves.toMatchObject({
      outcome: 'already-completed', record: { endMs },
    });
  });

  test('finishing saves unsaved start and note atomically, and invalid finish leaves all original fields', async () => {
    await repository.start({ id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: 'before' } });
    await expect(repository.finish('sleep-1', endMs, endMs, { startMs: endMs + 1, note: 'invalid' })).rejects.toThrow();
    expect(await repository.getById('sleep-1')).toMatchObject({ status: 'sleeping', startMs, note: 'before' });
    const newStart = startMs - 60_000;
    expect((await repository.finish('sleep-1', endMs, endMs, { startMs: newStart, note: ' after ' })).record)
      .toMatchObject({ status: 'completed', startMs: newStart, eventTimeMs: newStart, sortTimeMs: newStart, endMs, note: 'after' });
  });

  test('uses typed state-specific edits and re-derives fields from a changed start', async () => {
    await repository.start({ id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: null } });
    const movedStart = new Date(2026, 6, 9, 22, 0).getTime();
    await expect(repository.updateActive('sleep-1', { startMs: movedStart, note: ' moved ' }, startMs))
      .resolves.toMatchObject({ startMs: movedStart, eventTimeMs: movedStart, sortTimeMs: movedStart,
        recordDate: '2026-07-09', note: 'moved' });
    await expect(repository.updateCompleted('sleep-1', { startMs: movedStart, endMs, note: null }, endMs))
      .rejects.toBeInstanceOf(SleepRecordStateError);

    await repository.finish('sleep-1', endMs, endMs);
    const completedStart = new Date(2026, 6, 10, 20, 0).getTime();
    await expect(repository.updateCompleted('sleep-1', { startMs: completedStart, endMs, note: 'done' }, endMs))
      .resolves.toMatchObject({ status: 'completed', startMs: completedStart, endMs,
        eventTimeMs: completedStart, sortTimeMs: completedStart, recordDate: '2026-07-10' });
    await expect(repository.updateActive('sleep-1', { startMs, note: null }, endMs))
      .rejects.toBeInstanceOf(SleepRecordStateError);
  });

  test('projects cross-day sources and calculates completed natural-day overlap only', async () => {
    await repository.start({ id: 'completed', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: null } });
    await repository.finish('completed', endMs, endMs);
    await repository.start({
      id: 'active', clientRequestId: 'request-2', nowMs: endMs + 1,
      input: { startMs: endMs + 1, note: null },
    });
    await expect(repository.listByStartDate('2026-07-10')).resolves.toHaveLength(1);
    await expect(repository.listTimelineSources('2026-07-10')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'completed' })]),
    );
    await expect(repository.listTimelineSources('2026-07-11')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'completed' }),
        expect.objectContaining({ id: 'active' }),
      ]),
    );
    await expect(repository.getDailyCompletedTotalMs('2026-07-10')).resolves.toBe(60 * 60 * 1_000);
    await expect(repository.getDailyCompletedTotalMs('2026-07-11')).resolves.toBe(2 * 60 * 60 * 1_000);
  });

  test('deletes active or completed sleep records without touching other types', async () => {
    await repository.start({ id: 'sleep-1', clientRequestId: 'request-1', nowMs: startMs, input: { startMs, note: null } });
    await repository.delete('sleep-1');
    await expect(repository.getById('sleep-1')).resolves.toBeNull();
    await expect(repository.getActive()).resolves.toBeNull();
    await expect(repository.listTimelineSources('2026-07-10')).resolves.toEqual([]);
  });
});
