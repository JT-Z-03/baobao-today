import type { BabyRepository } from '@/application/ports/baby-repository';
import type { BabyProfile } from '@/domain/baby/baby';
import type { SQLiteDatabase } from 'expo-sqlite';

type SQLiteValue = string | number | null;

type BabyRow = {
  id: string;
  name: string;
  birth_date: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export interface BabyDatabase {
  getFirstAsync(sql: string): Promise<BabyRow | null>;
  runAsync(sql: string, params: Record<string, SQLiteValue>): Promise<unknown>;
}

function mapBabyRow(row: BabyRow): BabyProfile {
  return {
    id: row.id,
    name: row.name,
    birthDate: row.birth_date,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export class SQLiteBabyRepository implements BabyRepository {
  constructor(private readonly database: BabyDatabase) {}

  async get() {
    const row = await this.database.getFirstAsync(`
      SELECT id, name, birth_date, created_at_ms, updated_at_ms
      FROM baby
      WHERE singleton_key = 1
    `);
    return row ? mapBabyRow(row) : null;
  }

  async save(profile: BabyProfile) {
    await this.database.runAsync(
      `
        INSERT INTO baby (
          id, singleton_key, name, birth_date, created_at_ms, updated_at_ms
        ) VALUES (
          $id, 1, $name, $birthDate, $createdAtMs, $updatedAtMs
        )
        ON CONFLICT(singleton_key) DO UPDATE SET
          name = excluded.name,
          birth_date = excluded.birth_date,
          updated_at_ms = excluded.updated_at_ms
      `,
      {
        $id: profile.id,
        $name: profile.name,
        $birthDate: profile.birthDate,
        $createdAtMs: profile.createdAtMs,
        $updatedAtMs: profile.updatedAtMs,
      },
    );

    const persisted = await this.get();
    if (!persisted) throw new Error('Baby profile was not persisted');
    return persisted;
  }
}

export function createSQLiteBabyRepository(database: SQLiteDatabase) {
  return new SQLiteBabyRepository({
    getFirstAsync: (sql) => database.getFirstAsync<BabyRow>(sql),
    runAsync: (sql, params) => database.runAsync(sql, params),
  });
}
