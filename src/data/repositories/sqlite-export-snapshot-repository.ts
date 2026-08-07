import type { SQLiteDatabase } from 'expo-sqlite';

import type { ExportSnapshotRepository } from '@/application/ports/export';
import type { ExportRecord, ExportSnapshot } from '@/domain/export/csv-encoder';
import type { ResolvedExportRange } from '@/domain/export/export-range';

type SQLiteValue = string | number | null;

type BabyExportRow = { name: string; birth_date: string };
type ExportRow = {
  id: string;
  type: 'feeding' | 'poop' | 'pee' | 'sleep' | 'other';
  event_time_ms: number;
  record_date: string;
  created_at_ms: number;
  updated_at_ms: number;
  note: string | null;
  feeding_type: 'formula' | 'breast' | 'bottle_breast' | 'mixed' | null;
  milk_amount_ml: number | null;
  breast_milk_amount_ml: number | null;
  left_duration_min: number | null;
  right_duration_min: number | null;
  poop_color: 'yellow' | 'green' | 'brown' | 'black' | 'red' | 'other' | null;
  poop_texture: 'watery' | 'loose' | 'pasty' | 'formed' | 'pellet' | null;
  poop_amount: 'small' | 'medium' | 'large' | null;
  has_photo: number;
  pee_color: 'clear' | 'pale-yellow' | 'yellow' | 'dark-yellow' | null;
  pee_amount: 'small' | 'medium' | 'large' | null;
  sleep_start_ms: number | null;
  sleep_end_ms: number | null;
  sleep_status: 'sleeping' | 'completed' | null;
  other_title: string | null;
};

export interface ExportSnapshotQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
}

export interface ExportSnapshotDatabase {
  withExclusiveTransactionAsync(task: (transaction: ExportSnapshotQueryDatabase) => Promise<void>): Promise<void>;
}

function mapPoopTexture(value: ExportRow['poop_texture']) {
  if (value === 'loose') return 'soft' as const;
  if (value === 'pasty') return 'mushy' as const;
  return value;
}

function mapPeeColor(value: ExportRow['pee_color']) {
  if (value === 'pale-yellow') return 'light_yellow' as const;
  if (value === 'dark-yellow') return 'dark_yellow' as const;
  return value;
}

function base(row: ExportRow) {
  return {
    id: row.id,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    note: row.note,
  };
}

function mapRow(row: ExportRow): ExportRecord {
  if (row.type === 'feeding' && row.feeding_type) {
    return {
      ...base(row), type: 'feeding', feedingType: row.feeding_type,
      milkAmountMl: row.milk_amount_ml,
      breastMilkAmountMl: row.breast_milk_amount_ml,
      leftDurationMin: row.left_duration_min,
      rightDurationMin: row.right_duration_min,
    };
  }
  if (row.type === 'poop') {
    return {
      ...base(row), type: 'poop', poopColor: row.poop_color,
      poopTexture: mapPoopTexture(row.poop_texture), poopAmount: row.poop_amount,
      hasPhoto: row.has_photo === 1,
    };
  }
  if (row.type === 'pee') {
    return {
      ...base(row), type: 'pee', peeColor: mapPeeColor(row.pee_color), peeAmount: row.pee_amount,
    };
  }
  if (row.type === 'sleep' && row.sleep_status && row.sleep_start_ms !== null) {
    return {
      ...base(row), type: 'sleep', sleepStatus: row.sleep_status,
      sleepStartMs: row.sleep_start_ms, sleepEndMs: row.sleep_end_ms,
    };
  }
  if (row.type === 'other' && row.other_title !== null) {
    return { ...base(row), type: 'other', title: row.other_title };
  }
  throw new Error(`无法导出语义不完整的${row.type}记录`);
}

const exportColumns = `
  id, type, event_time_ms, record_date, created_at_ms, updated_at_ms, note,
  feeding_type, milk_amount_ml, breast_milk_amount_ml, left_duration_min, right_duration_min,
  poop_color, poop_texture, poop_amount,
  CASE WHEN photo_uri IS NULL THEN 0 ELSE 1 END AS has_photo,
  pee_color, pee_amount, sleep_start_ms, sleep_end_ms, sleep_status, other_title
`;

export class SQLiteExportSnapshotRepository implements ExportSnapshotRepository {
  constructor(private readonly database: ExportSnapshotDatabase) {}

  async getSnapshot(range: ResolvedExportRange, capturedAtMs: number): Promise<ExportSnapshot> {
    let snapshot: ExportSnapshot | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const baby = await transaction.getFirstAsync<BabyExportRow>(`
        SELECT name, birth_date FROM baby WHERE singleton_key = 1
      `);
      if (!baby) throw new Error('宝宝资料不存在');

      const rows = range.kind === 'all'
        ? await transaction.getAllAsync<ExportRow>(`
            SELECT ${exportColumns} FROM records
            ORDER BY event_time_ms ASC, created_at_ms ASC, id ASC
          `)
        : await transaction.getAllAsync<ExportRow>(`
            SELECT ${exportColumns} FROM records
            WHERE (
              type <> 'sleep' AND event_time_ms >= ? AND event_time_ms < ?
            ) OR (
              type = 'sleep' AND sleep_start_ms < ? AND COALESCE(sleep_end_ms, ?) > ?
            )
            ORDER BY event_time_ms ASC, created_at_ms ASC, id ASC
          `, range.startMs, range.endExclusiveMs, range.endExclusiveMs, capturedAtMs, range.startMs);

      snapshot = {
        capturedAtMs,
        baby: { name: baby.name, birthDate: baby.birth_date },
        records: rows.map(mapRow),
      };
    });
    if (!snapshot) throw new Error('导出快照读取失败');
    return snapshot;
  }
}

export function createSQLiteExportSnapshotRepository(database: SQLiteDatabase) {
  return new SQLiteExportSnapshotRepository({
    withExclusiveTransactionAsync: (task) => database.withExclusiveTransactionAsync((transaction) => task({
      getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
      getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
    })),
  });
}
