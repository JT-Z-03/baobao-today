/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import type { PoopCoreInput } from '@/domain/poop/poop';
import { MIGRATIONS } from '@/data/database/migrations';

import {
  IdempotencyConflictError,
  SQLitePoopRepository,
  type PoopDatabase,
} from './sqlite-poop-repository';

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
  const database: PoopDatabase = {
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
    if (!hashes.has(payload)) hashes.set(payload, ((hashes.size + 1) % 10).toString().repeat(64));
    return hashes.get(payload)!;
  };
}

const july11 = new Date(2026, 6, 11, 8, 0).getTime();
function poopInput(overrides: Partial<PoopCoreInput> = {}): PoopCoreInput {
  return {
    eventTimeMs: july11,
    color: null,
    texture: null,
    amount: null,
    note: null,
    ...overrides,
  };
}

describe('SQLitePoopRepository host SQLite integration', () => {
  let sqlite: InstanceType<typeof DatabaseSync>;
  let repository: SQLitePoopRepository;

  beforeEach(() => {
    const setup = createDatabaseAdapter();
    sqlite = setup.sqlite;
    repository = new SQLitePoopRepository(setup.database, createHashStub());
  });
  afterEach(() => sqlite.close());

  test('creates empty and photographed records with repository-derived fields', async () => {
    const empty = await repository.create({
      id: 'poop-1', clientRequestId: 'request-1', input: poopInput(),
      photoUri: null, photoContentFingerprint: null, nowMs: july11,
    });
    const photographed = await repository.create({
      id: 'poop-2', clientRequestId: 'request-2', input: poopInput({ eventTimeMs: july11 + 1 }),
      photoUri: 'poop-photos/request-2.jpg', photoContentFingerprint: 'photo-a', nowMs: july11 + 1,
    });

    expect(empty).toMatchObject({ type: 'poop', recordDate: '2026-07-11', photoUri: null });
    expect(photographed.photoUri).toBe('poop-photos/request-2.jpg');
    await expect(repository.listByDate('2026-07-11')).resolves.toHaveLength(2);
    await expect(repository.getDailyCount('2026-07-11')).resolves.toBe(2);
  });

  test('maps the legacy SQLite texture codes at the repository boundary', async () => {
    const record = await repository.create({
      id: 'poop-1', clientRequestId: 'request-1', input: poopInput({ texture: 'soft' }),
      photoUri: null, photoContentFingerprint: null, nowMs: july11,
    });
    const row = sqlite.prepare('SELECT poop_texture FROM records WHERE id = ?').get('poop-1') as { poop_texture: string };
    expect(row.poop_texture).toBe('loose');
    expect(record.texture).toBe('soft');
  });

  test('returns the same payload and rejects a different payload for one request id', async () => {
    const command = {
      id: 'poop-1', clientRequestId: 'request-1', input: poopInput(),
      photoUri: 'poop-photos/request-1.jpg', photoContentFingerprint: 'same-photo', nowMs: july11,
    };
    const first = await repository.create(command);
    await expect(repository.create({ ...command, id: 'ignored' })).resolves.toEqual(first);
    await expect(repository.create({ ...command, id: 'conflict', photoContentFingerprint: 'other-photo' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('updates typed fields, re-derives date, and cannot change type', async () => {
    await repository.create({
      id: 'poop-1', clientRequestId: 'request-1', input: poopInput(),
      photoUri: null, photoContentFingerprint: null, nowMs: july11,
    });
    const moved = new Date(2026, 6, 10, 23, 0).getTime();
    const updated = await repository.update('poop-1', {
      ...poopInput({ eventTimeMs: moved, color: 'yellow', texture: 'mushy', amount: 'medium' }),
      photoUri: 'poop-photos/replacement.jpg',
      type: 'feeding',
    } as unknown as Parameters<SQLitePoopRepository['update']>[1], july11 + 1);

    expect(updated).toMatchObject({
      type: 'poop', recordDate: '2026-07-10', sortTimeMs: moved,
      color: 'yellow', texture: 'mushy', amount: 'medium',
    });
    expect(updated.clientRequestId).toBe('request-1');
  });

  test('deletes a record and lists referenced managed photos', async () => {
    await repository.create({
      id: 'poop-1', clientRequestId: 'request-1', input: poopInput(),
      photoUri: 'poop-photos/request-1.jpg', photoContentFingerprint: 'photo', nowMs: july11,
    });
    await expect(repository.listReferencedPhotoPaths()).resolves.toEqual(['poop-photos/request-1.jpg']);
    await repository.delete('poop-1');
    await expect(repository.getById('poop-1')).resolves.toBeNull();
  });
});
