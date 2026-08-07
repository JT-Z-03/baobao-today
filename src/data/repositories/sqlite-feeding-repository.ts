import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CreateFeedingCommand,
  FeedingRepository,
} from '@/application/ports/feeding-repository';
import type {
  FeedingDailySummary,
  FeedingRecord,
  FeedingType,
  FeedingUpdateInput,
} from '@/domain/feeding/feeding';
import {
  normalizeAndValidateFeedingInput,
  serializeFeedingCreatePayload,
} from '@/domain/feeding/feeding-validation';
import { deriveRecordFields } from '@/domain/records/record-derived-fields';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

export { IdempotencyConflictError } from '@/domain/records/idempotency';

type SQLiteValue = string | number | null;

type FeedingRow = {
  id: string;
  client_request_id: string;
  create_payload_hash: string;
  type: string;
  event_time_ms: number;
  record_date: string;
  sort_time_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
  note: string | null;
  feeding_type: FeedingType;
  milk_amount_ml: number | null;
  breast_milk_amount_ml: number | null;
  left_duration_min: number | null;
  right_duration_min: number | null;
};

type SummaryRow = {
  feeding_count: number;
  formula_total_ml: number;
  breast_milk_total_ml: number;
  measurable_total_ml: number;
};

type MilkAmountRow = { milk_amount_ml: number };

export interface FeedingQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface FeedingDatabase extends FeedingQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: FeedingQueryDatabase) => Promise<void>): Promise<void>;
}

type HashPayload = (payload: string) => Promise<string>;

export class FeedingRecordNotFoundError extends Error {
  constructor(readonly recordId: string) {
    super('喝奶记录不存在或已被删除');
    this.name = 'FeedingRecordNotFoundError';
  }
}

const feedingColumns = `
  id, client_request_id, create_payload_hash, type,
  event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note,
  feeding_type, milk_amount_ml, breast_milk_amount_ml, left_duration_min, right_duration_min
`;

function mapRow(row: FeedingRow): FeedingRecord {
  if (row.type !== 'feeding') throw new FeedingRecordNotFoundError(row.id);
  return {
    id: row.id,
    type: 'feeding',
    clientRequestId: row.client_request_id,
    createPayloadHash: row.create_payload_hash,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    sortTimeMs: row.sort_time_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    note: row.note,
    feedingType: row.feeding_type,
    milkAmountMl: row.milk_amount_ml,
    breastMilkAmountMl: row.breast_milk_amount_ml,
    leftDurationMin: row.left_duration_min,
    rightDurationMin: row.right_duration_min,
  };
}

async function getById(database: FeedingQueryDatabase, id: string) {
  const row = await database.getFirstAsync<FeedingRow>(
    `SELECT ${feedingColumns} FROM records WHERE id = ?`,
    id,
  );
  return row ? mapRow(row) : null;
}

async function getByClientRequestId(database: FeedingQueryDatabase, clientRequestId: string) {
  return database.getFirstAsync<FeedingRow>(
    `SELECT ${feedingColumns} FROM records WHERE client_request_id = ?`,
    clientRequestId,
  );
}

export class SQLiteFeedingRepository implements FeedingRepository {
  constructor(
    private readonly database: FeedingDatabase,
    private readonly hashPayload: HashPayload,
  ) {}

  async create(command: CreateFeedingCommand): Promise<FeedingRecord> {
    const normalized = normalizeAndValidateFeedingInput(command.input, command.nowMs);
    const payloadHash = await this.hashPayload(serializeFeedingCreatePayload(normalized));
    const derived = deriveRecordFields({ type: 'feeding', eventTimeMs: normalized.eventTimeMs });
    let result: FeedingRecord | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      try {
        await transaction.runAsync(
          `
            INSERT INTO records (
              id, client_request_id, create_payload_hash, type,
              event_time_ms, record_date, sort_time_ms,
              created_at_ms, updated_at_ms, note,
              feeding_type, milk_amount_ml, breast_milk_amount_ml,
              left_duration_min, right_duration_min
            ) VALUES (?, ?, ?, 'feeding', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          command.id,
          command.clientRequestId,
          payloadHash,
          normalized.eventTimeMs,
          derived.recordDate,
          derived.sortTimeMs,
          command.nowMs,
          command.nowMs,
          normalized.note,
          normalized.feedingType,
          normalized.milkAmountMl,
          normalized.breastMilkAmountMl,
          normalized.leftDurationMin,
          normalized.rightDurationMin,
        );
      } catch (error) {
        const existing = await getByClientRequestId(transaction, command.clientRequestId);
        if (!existing) throw error;
        if (existing.type !== 'feeding' || existing.create_payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(command.clientRequestId);
        }
        result = mapRow(existing);
        return;
      }

      result = await getById(transaction, command.id);
    });

    const persisted = result as FeedingRecord | null;
    if (!persisted) throw new Error('喝奶记录保存后无法读取');
    return persisted;
  }

  getById(id: string) {
    return getById(this.database, id);
  }

  async update(id: string, input: FeedingUpdateInput, nowMs: number): Promise<FeedingRecord> {
    let result: FeedingRecord | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new FeedingRecordNotFoundError(id);

      const normalized = normalizeAndValidateFeedingInput(input, nowMs);
      const derived = deriveRecordFields({ type: 'feeding', eventTimeMs: normalized.eventTimeMs });
      await transaction.runAsync(
        `
          UPDATE records
          SET event_time_ms = ?, record_date = ?, sort_time_ms = ?, updated_at_ms = ?,
              note = ?, feeding_type = ?, milk_amount_ml = ?, breast_milk_amount_ml = ?,
              left_duration_min = ?, right_duration_min = ?
          WHERE id = ? AND type = 'feeding'
        `,
        normalized.eventTimeMs,
        derived.recordDate,
        derived.sortTimeMs,
        nowMs,
        normalized.note,
        normalized.feedingType,
        normalized.milkAmountMl,
        normalized.breastMilkAmountMl,
        normalized.leftDurationMin,
        normalized.rightDurationMin,
        id,
      );
      result = await getById(transaction, id);
    });

    const persisted = result as FeedingRecord | null;
    if (!persisted) throw new FeedingRecordNotFoundError(id);
    return persisted;
  }

  async delete(id: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new FeedingRecordNotFoundError(id);
      await transaction.runAsync(`DELETE FROM records WHERE id = ? AND type = 'feeding'`, id);
    });
  }

  async listByDate(recordDate: string) {
    const rows = await this.database.getAllAsync<FeedingRow>(
      `
        SELECT ${feedingColumns}
        FROM records
        WHERE type = 'feeding' AND record_date = ?
        ORDER BY sort_time_ms DESC, created_at_ms DESC, id DESC
      `,
      recordDate,
    );
    return rows.map(mapRow);
  }

  async getLatest() {
    const row = await this.database.getFirstAsync<FeedingRow>(`
      SELECT ${feedingColumns}
      FROM records
      WHERE type = 'feeding'
      ORDER BY sort_time_ms DESC, created_at_ms DESC, id DESC
      LIMIT 1
    `);
    return row ? mapRow(row) : null;
  }

  async getLatestMilkAmount() {
    const row = await this.database.getFirstAsync<MilkAmountRow>(`
      SELECT milk_amount_ml
      FROM records
      WHERE type = 'feeding' AND milk_amount_ml IS NOT NULL
      ORDER BY sort_time_ms DESC, created_at_ms DESC, id DESC
      LIMIT 1
    `);
    return row?.milk_amount_ml ?? null;
  }

  async getDailySummary(recordDate: string): Promise<FeedingDailySummary> {
    const row = await this.database.getFirstAsync<SummaryRow>(
      `
        SELECT
          COUNT(*) AS feeding_count,
          COALESCE(SUM(milk_amount_ml), 0) AS formula_total_ml,
          COALESCE(SUM(breast_milk_amount_ml), 0) AS breast_milk_total_ml,
          COALESCE(SUM(COALESCE(milk_amount_ml, 0) + COALESCE(breast_milk_amount_ml, 0)), 0)
            AS measurable_total_ml
        FROM records
        WHERE type = 'feeding' AND record_date = ?
      `,
      recordDate,
    );
    return {
      feedingCount: row?.feeding_count ?? 0,
      formulaTotalMl: row?.formula_total_ml ?? 0,
      breastMilkTotalMl: row?.breast_milk_total_ml ?? 0,
      measurableTotalMl: row?.measurable_total_ml ?? 0,
    };
  }
}

function createTransactionAdapter(database: SQLiteDatabase): FeedingDatabase {
  const query: FeedingQueryDatabase = {
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    getAllAsync: (sql, ...params) => database.getAllAsync(sql, ...params),
    runAsync: (sql, ...params) => database.runAsync(sql, ...params),
  };
  return {
    ...query,
    withExclusiveTransactionAsync: (task) =>
      database.withExclusiveTransactionAsync((transaction) =>
        task({
          getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
          getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
          runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
        }),
      ),
  };
}

export function createSQLiteFeedingRepository(database: SQLiteDatabase) {
  return new SQLiteFeedingRepository(createTransactionAdapter(database), (payload) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
  );
}
