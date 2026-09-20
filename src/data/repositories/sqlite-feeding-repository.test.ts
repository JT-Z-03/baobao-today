/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import type { FeedingUpdateInput } from '@/domain/feeding/feeding';
import { MIGRATIONS } from '@/data/database/migrations';

import {
  IdempotencyConflictError,
  SQLiteFeedingRepository,
  type FeedingDatabase,
} from './sqlite-feeding-repository';

function createDatabaseAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);

  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(sql).run(...params),
  };
  const database: FeedingDatabase = {
    ...query,
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
  return { sqlite, database };
}

function createHashStub() {
  const hashes = new Map<string, string>();
  return async (payload: string) => {
    if (!hashes.has(payload)) {
      const digit = ((hashes.size + 1) % 10).toString();
      hashes.set(payload, digit.repeat(64));
    }
    return hashes.get(payload)!;
  };
}

const july11Morning = new Date(2026, 6, 11, 8, 0).getTime();

function formulaInput(eventTimeMs = july11Morning, milkAmountMl = 60) {
  return {
    eventTimeMs,
    feedingType: 'formula' as const,
    milkAmountMl,
    breastMilkAmountMl: null,
    leftDurationMin: null,
    rightDurationMin: null,
    note: null,
  };
}

describe('SQLiteFeedingRepository host SQLite integration', () => {
  let sqlite: InstanceType<typeof DatabaseSync>;
  let repository: SQLiteFeedingRepository;

  beforeEach(() => {
    const setup = createDatabaseAdapter();
    sqlite = setup.sqlite;
    repository = new SQLiteFeedingRepository(setup.database, createHashStub());
  });

  afterEach(() => sqlite.close());

  test('measured history stays separated by component and uses occurrence order including mixed records', async () => {
    await repository.create({ id:'a', clientRequestId:'a', input:formulaInput(july11Morning, 60), nowMs:july11Morning });
    await repository.create({ id:'b', clientRequestId:'b', input:{...formulaInput(july11Morning + 1000, 90), feedingType:'mixed', breastMilkAmountMl:80}, nowMs:july11Morning + 1000 });
    await repository.create({ id:'c', clientRequestId:'c', input:formulaInput(july11Morning - 1000, 30), nowMs:july11Morning + 2000 });
    expect(await repository.getLatestMeasured('formula')).toEqual({ amountMl:90, eventTimeMs:july11Morning + 1000 });
    expect(await repository.getLatestMeasured('bottle_breast')).toEqual({ amountMl:80, eventTimeMs:july11Morning + 1000 });
  });

  test('creates and reads a feeding record with repository-derived fields', async () => {
    const record = await repository.create({
      id: 'feeding-1',
      clientRequestId: 'request-1',
      input: formulaInput(),
      nowMs: july11Morning,
    });

    expect(record).toMatchObject({
      id: 'feeding-1',
      type: 'feeding',
      recordDate: '2026-07-11',
      sortTimeMs: july11Morning,
      milkAmountMl: 60,
    });
    await expect(repository.getById('feeding-1')).resolves.toEqual(record);
  });

  test('returns the existing record for the same request and normalized payload', async () => {
    const first = await repository.create({
      id: 'feeding-1',
      clientRequestId: 'request-1',
      input: formulaInput(),
      nowMs: july11Morning,
    });
    const repeated = await repository.create({
      id: 'ignored-new-id',
      clientRequestId: 'request-1',
      input: { ...formulaInput(), leftDurationMin: 99 },
      nowMs: july11Morning + 1_000,
    });

    expect(repeated).toEqual(first);
    expect(await repository.listByDate('2026-07-11')).toHaveLength(1);
  });

  test('rejects the same request id with a different normalized payload', async () => {
    await repository.create({
      id: 'feeding-1',
      clientRequestId: 'request-1',
      input: formulaInput(),
      nowMs: july11Morning,
    });

    await expect(
      repository.create({
        id: 'feeding-2',
        clientRequestId: 'request-1',
        input: formulaInput(july11Morning, 90),
        nowMs: july11Morning,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('round-trips bottled breast milk and includes it in idempotency', async () => {
    const input = {
      eventTimeMs: july11Morning,
      feedingType: 'bottle_breast' as const,
      milkAmountMl: null,
      breastMilkAmountMl: 80,
      leftDurationMin: null,
      rightDurationMin: null,
      note: null,
    };
    const first = await repository.create({
      id: 'bottle-1', clientRequestId: 'request-1', input, nowMs: july11Morning,
    });

    expect(first).toMatchObject({ feedingType: 'bottle_breast', breastMilkAmountMl: 80 });
    await expect(repository.create({
      id: 'bottle-2',
      clientRequestId: 'request-1',
      input: { ...input, breastMilkAmountMl: 90 },
      nowMs: july11Morning,
    })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('rejects a request id already used by another record type as an idempotency conflict', async () => {
    sqlite.prepare(`
      INSERT INTO records (
        id, client_request_id, create_payload_hash, type,
        event_time_ms, record_date, sort_time_ms,
        created_at_ms, updated_at_ms, other_title
      ) VALUES (?, ?, ?, 'other', ?, '2026-07-11', ?, ?, ?, '洗澡')
    `).run(
      'other-1',
      'shared-request',
      'f'.repeat(64),
      july11Morning,
      july11Morning,
      july11Morning,
      july11Morning,
    );

    await expect(
      repository.create({
        id: 'feeding-1',
        clientRequestId: 'shared-request',
        input: formulaInput(),
        nowMs: july11Morning,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('updates only feeding fields, clears stale fields, and re-derives the date', async () => {
    await repository.create({
      id: 'feeding-1',
      clientRequestId: 'request-1',
      input: {
        ...formulaInput(),
        feedingType: 'mixed',
        milkAmountMl: 60,
        leftDurationMin: 10,
        rightDurationMin: 5,
      },
      nowMs: july11Morning,
    });
    const movedTime = new Date(2026, 6, 10, 23, 0).getTime();
    const update = {
      ...formulaInput(movedTime, 90),
      type: 'poop',
    } as unknown as FeedingUpdateInput;

    const updated = await repository.update('feeding-1', update, july11Morning);

    expect(updated).toMatchObject({
      type: 'feeding',
      feedingType: 'formula',
      milkAmountMl: 90,
      leftDurationMin: null,
      rightDurationMin: null,
      recordDate: '2026-07-10',
      sortTimeMs: movedTime,
    });
    expect(updated.clientRequestId).toBe('request-1');
    expect(updated.createdAtMs).toBe(july11Morning);
  });

  test('aggregates source records after amount edits, date moves, and deletion', async () => {
    await repository.create({
      id: 'formula',
      clientRequestId: 'request-formula',
      input: formulaInput(july11Morning, 60),
      nowMs: july11Morning,
    });
    await repository.create({
      id: 'bottle',
      clientRequestId: 'request-bottle',
      input: {
        ...formulaInput(july11Morning + 60_000),
        feedingType: 'bottle_breast',
        milkAmountMl: null,
        breastMilkAmountMl: 80,
      },
      nowMs: july11Morning + 60_000,
    });
    await repository.create({
      id: 'mixed',
      clientRequestId: 'request-mixed',
      input: {
        ...formulaInput(july11Morning + 120_000, 40),
        feedingType: 'mixed',
        breastMilkAmountMl: 50,
        leftDurationMin: 8,
        rightDurationMin: 0,
      },
      nowMs: july11Morning + 120_000,
    });
    await repository.create({
      id: 'breast',
      clientRequestId: 'request-breast',
      input: {
        ...formulaInput(july11Morning + 180_000),
        feedingType: 'breast',
        milkAmountMl: null,
        leftDurationMin: 0,
        rightDurationMin: 12,
      },
      nowMs: july11Morning + 180_000,
    });

    await expect(repository.getDailySummary('2026-07-11')).resolves.toEqual({
      feedingCount: 4,
      formulaTotalMl: 100,
      breastMilkTotalMl: 130,
      measurableTotalMl: 230,
    });
    await expect(repository.getLatest()).resolves.toMatchObject({ id: 'breast' });
    await expect(repository.getLatestMilkAmount()).resolves.toBe(40);

    await repository.update('formula', formulaInput(july11Morning, 90), july11Morning + 180_000);
    await expect(repository.getDailySummary('2026-07-11')).resolves.toEqual({
      feedingCount: 4,
      formulaTotalMl: 130,
      breastMilkTotalMl: 130,
      measurableTotalMl: 260,
    });

    const previousDay = new Date(2026, 6, 10, 20, 0).getTime();
    await repository.update('mixed', {
      ...formulaInput(previousDay, 40),
      feedingType: 'mixed',
      breastMilkAmountMl: 50,
      leftDurationMin: 8,
      rightDurationMin: 0,
    }, july11Morning + 240_000);
    await expect(repository.getDailySummary('2026-07-11')).resolves.toEqual({
      feedingCount: 3,
      formulaTotalMl: 90,
      breastMilkTotalMl: 80,
      measurableTotalMl: 170,
    });
    await expect(repository.getDailySummary('2026-07-10')).resolves.toEqual({
      feedingCount: 1,
      formulaTotalMl: 40,
      breastMilkTotalMl: 50,
      measurableTotalMl: 90,
    });

    await repository.delete('formula');
    await expect(repository.getById('formula')).resolves.toBeNull();
    await expect(repository.getDailySummary('2026-07-11')).resolves.toEqual({
      feedingCount: 2,
      formulaTotalMl: 0,
      breastMilkTotalMl: 80,
      measurableTotalMl: 80,
    });
  });

  test('uses id as the final stable tie-breaker for the latest feeding', async () => {
    await repository.create({
      id: 'feeding-a',
      clientRequestId: 'request-a',
      input: formulaInput(),
      nowMs: july11Morning,
    });
    await repository.create({
      id: 'feeding-b',
      clientRequestId: 'request-b',
      input: formulaInput(),
      nowMs: july11Morning,
    });

    await expect(repository.getLatest()).resolves.toMatchObject({ id: 'feeding-b' });
  });
});
