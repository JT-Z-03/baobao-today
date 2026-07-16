import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CreatePeeCommand,
  PeeRepository,
} from '@/application/ports/pee-repository';
import type { PeeAmount, PeeColor, PeeRecord, PeeUpdateInput } from '@/domain/pee/pee';
import {
  normalizeAndValidatePeeInput,
  serializePeeCreatePayload,
} from '@/domain/pee/pee-validation';
import { deriveRecordFields } from '@/domain/records/record-derived-fields';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

export { IdempotencyConflictError } from '@/domain/records/idempotency';

type SQLiteValue = string | number | null;
type StoredPeeColor = 'clear' | 'pale-yellow' | 'yellow' | 'dark-yellow';

type PeeRow = {
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
  pee_amount: PeeAmount | null;
  pee_color: StoredPeeColor | null;
};

export interface PeeQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface PeeDatabase extends PeeQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: PeeQueryDatabase) => Promise<void>): Promise<void>;
}

type HashPayload = (payload: string) => Promise<string>;

export class PeeRecordNotFoundError extends Error {
  constructor(readonly recordId: string) {
    super('小便记录不存在或已被删除');
    this.name = 'PeeRecordNotFoundError';
  }
}

const columns = `
  id, client_request_id, create_payload_hash, type,
  event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note,
  pee_amount, pee_color
`;

function toStoredColor(value: PeeColor | null): StoredPeeColor | null {
  if (value === 'light_yellow') return 'pale-yellow';
  if (value === 'dark_yellow') return 'dark-yellow';
  return value;
}

function fromStoredColor(value: StoredPeeColor | null): PeeColor | null {
  if (value === 'pale-yellow') return 'light_yellow';
  if (value === 'dark-yellow') return 'dark_yellow';
  return value;
}

function mapRow(row: PeeRow): PeeRecord {
  if (row.type !== 'pee') throw new PeeRecordNotFoundError(row.id);
  return {
    id: row.id,
    type: 'pee',
    clientRequestId: row.client_request_id,
    createPayloadHash: row.create_payload_hash,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    sortTimeMs: row.sort_time_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    note: row.note,
    amount: row.pee_amount,
    color: fromStoredColor(row.pee_color),
  };
}

async function getById(database: PeeQueryDatabase, id: string) {
  const row = await database.getFirstAsync<PeeRow>(`SELECT ${columns} FROM records WHERE id = ?`, id);
  return row ? mapRow(row) : null;
}

async function getByClientRequestId(database: PeeQueryDatabase, clientRequestId: string) {
  return database.getFirstAsync<PeeRow>(
    `SELECT ${columns} FROM records WHERE client_request_id = ?`,
    clientRequestId,
  );
}

export class SQLitePeeRepository implements PeeRepository {
  constructor(
    private readonly database: PeeDatabase,
    private readonly hashPayload: HashPayload,
  ) {}

  async create(command: CreatePeeCommand): Promise<PeeRecord> {
    const normalized = normalizeAndValidatePeeInput(command.input, command.nowMs);
    const payloadHash = await this.hashPayload(serializePeeCreatePayload(normalized));
    const derived = deriveRecordFields({ type: 'pee', eventTimeMs: normalized.eventTimeMs });
    let result: PeeRecord | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      try {
        await transaction.runAsync(
          `
            INSERT INTO records (
              id, client_request_id, create_payload_hash, type,
              event_time_ms, record_date, sort_time_ms,
              created_at_ms, updated_at_ms, note,
              pee_amount, pee_color
            ) VALUES (?, ?, ?, 'pee', ?, ?, ?, ?, ?, ?, ?, ?)
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
          normalized.amount,
          toStoredColor(normalized.color),
        );
      } catch (error) {
        const existing = await getByClientRequestId(transaction, command.clientRequestId);
        if (!existing) throw error;
        if (existing.type !== 'pee' || existing.create_payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(command.clientRequestId);
        }
        result = mapRow(existing);
        return;
      }
      result = await getById(transaction, command.id);
    });

    if (!result) throw new Error('小便记录保存后无法读取');
    return result;
  }

  getById(id: string) {
    return getById(this.database, id);
  }

  async update(id: string, input: PeeUpdateInput, nowMs: number): Promise<PeeRecord> {
    const normalized = normalizeAndValidatePeeInput(input, nowMs);
    let result: PeeRecord | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new PeeRecordNotFoundError(id);
      const derived = deriveRecordFields({ type: 'pee', eventTimeMs: normalized.eventTimeMs });
      await transaction.runAsync(
        `
          UPDATE records
          SET event_time_ms = ?, record_date = ?, sort_time_ms = ?, updated_at_ms = ?,
              note = ?, pee_amount = ?, pee_color = ?,
              feeding_type = NULL, milk_amount_ml = NULL,
              left_duration_min = NULL, right_duration_min = NULL,
              poop_color = NULL, poop_texture = NULL, poop_amount = NULL, photo_uri = NULL,
              sleep_start_ms = NULL, sleep_end_ms = NULL, sleep_status = NULL,
              other_title = NULL
          WHERE id = ? AND type = 'pee'
        `,
        normalized.eventTimeMs,
        derived.recordDate,
        derived.sortTimeMs,
        nowMs,
        normalized.note,
        normalized.amount,
        toStoredColor(normalized.color),
        id,
      );
      result = await getById(transaction, id);
    });

    if (!result) throw new PeeRecordNotFoundError(id);
    return result;
  }

  async delete(id: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new PeeRecordNotFoundError(id);
      await transaction.runAsync(`DELETE FROM records WHERE id = ? AND type = 'pee'`, id);
    });
  }

  async listByDate(recordDate: string) {
    const rows = await this.database.getAllAsync<PeeRow>(
      `SELECT ${columns} FROM records WHERE type = 'pee' AND record_date = ? ORDER BY sort_time_ms DESC, created_at_ms DESC`,
      recordDate,
    );
    return rows.map(mapRow);
  }

  async getDailyCount(recordDate: string) {
    const row = await this.database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM records WHERE type = 'pee' AND record_date = ?`,
      recordDate,
    );
    return row?.count ?? 0;
  }
}

function createTransactionAdapter(database: SQLiteDatabase): PeeDatabase {
  const query: PeeQueryDatabase = {
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

export function createSQLitePeeRepository(database: SQLiteDatabase) {
  return new SQLitePeeRepository(createTransactionAdapter(database), (payload) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
  );
}
