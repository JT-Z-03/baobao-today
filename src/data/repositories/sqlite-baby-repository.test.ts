import { SQLiteBabyRepository, type BabyDatabase } from './sqlite-baby-repository';

const row = {
  id: 'baby-1',
  name: '小宝',
  birth_date: '2026-07-10',
  created_at_ms: 100,
  updated_at_ms: 200,
};

describe('SQLiteBabyRepository unit contract', () => {
  test('maps the database row to the domain profile', async () => {
    const database: BabyDatabase = {
      getFirstAsync: jest.fn(async () => row),
      runAsync: jest.fn(),
    };

    await expect(new SQLiteBabyRepository(database).get()).resolves.toEqual({
      id: 'baby-1',
      name: '小宝',
      birthDate: '2026-07-10',
      createdAtMs: 100,
      updatedAtMs: 200,
    });
  });

  test('returns the canonical persisted row after an upsert', async () => {
    const database: BabyDatabase = {
      getFirstAsync: jest.fn(async () => row),
      runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
    };
    const repository = new SQLiteBabyRepository(database);

    const saved = await repository.save({
      id: 'new-id',
      name: '小宝',
      birthDate: '2026-07-10',
      createdAtMs: 100,
      updatedAtMs: 200,
    });

    expect(saved.id).toBe('baby-1');
    expect(database.runAsync).toHaveBeenCalledTimes(1);
  });
});
