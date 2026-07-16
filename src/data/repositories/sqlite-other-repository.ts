import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CreateOtherCommand,
  OtherRepository,
} from '@/application/ports/other-repository';
import type { OtherRecord, OtherUpdateInput } from '@/domain/other/other';
import {
  normalizeAndValidateOtherInput,
  serializeOtherCreatePayload,
} from '@/domain/other/other-validation';
import { IdempotencyConflictError } from '@/domain/records/idempotency';
import { deriveRecordFields } from '@/domain/records/record-derived-fields';

export { IdempotencyConflictError } from '@/domain/records/idempotency';

type SQLiteValue = string | number | null;

type OtherRow = {
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
  other_title: string | null;
};

export interface OtherQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface OtherDatabase extends OtherQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: OtherQueryDatabase) => Promise<void>): Promise<void>;
}

type HashPayload = (payload: string) => Promise<string>;

export class OtherRecordNotFoundError extends Error {
  constructor(readonly recordId: string) {
    super('其他记录不存在或已被删除');
    this.name = 'OtherRecordNotFoundError';
  }
}

const otherColumns = `
  id, client_request_id, create_payload_hash, type,
  event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note, other_title
`;

function mapRow(row: OtherRow): OtherRecord {
  if (row.type !== 'other' || row.other_title === null) {
    throw new OtherRecordNotFoundError(row.id);
  }
  return {
    id: row.id,
    type: 'other',
    clientRequestId: row.client_request_id,
    createPayloadHash: row.create_payload_hash,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    sortTimeMs: row.sort_time_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    title: row.other_title,
    note: row.note,
  };
}

async function getById(database: OtherQueryDatabase, id: string) {
  const row = await database.getFirstAsync<OtherRow>(
    `SELECT ${otherColumns} FROM records WHERE id = ? AND type = 'other'`, id,
  );
  return row ? mapRow(row) : null;
}

async function getByClientRequestId(database: OtherQueryDatabase, clientRequestId: string) {
  return database.getFirstAsync<OtherRow>(
    `SELECT ${otherColumns} FROM records WHERE client_request_id = ?`, clientRequestId,
  );
}

export class SQLiteOtherRepository implements OtherRepository {
  constructor(
    private readonly database: OtherDatabase,
    private readonly hashPayload: HashPayload,
  ) {}

  async create(command: CreateOtherCommand) {
    const normalized = normalizeAndValidateOtherInput(command.input, command.nowMs);
    const payloadHash = await this.hashPayload(serializeOtherCreatePayload(normalized));
    const derived = deriveRecordFields({ type: 'other', eventTimeMs: normalized.eventTimeMs });
    let result: OtherRecord | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      try {
        await transaction.runAsync(`INSERT INTO records (
          id, client_request_id, create_payload_hash, type,
          event_time_ms, record_date, sort_time_ms,
          created_at_ms, updated_at_ms, note, other_title
        ) VALUES (?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?)`,
        command.id, command.clientRequestId, payloadHash,
        normalized.eventTimeMs, derived.recordDate, derived.sortTimeMs,
        command.nowMs, command.nowMs, normalized.note, normalized.title);
      } catch (error) {
        const existing = await getByClientRequestId(transaction, command.clientRequestId);
        if (!existing) throw error;
        if (existing.type !== 'other' || existing.create_payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(command.clientRequestId);
        }
        result = mapRow(existing);
        return;
      }
      result = await getById(transaction, command.id);
    });

    if (!result) throw new Error('其他记录保存后无法读取');
    return result;
  }

  getById(id: string) {
    return getById(this.database, id);
  }

  async update(id: string, input: OtherUpdateInput, nowMs: number) {
    let result: OtherRecord | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new OtherRecordNotFoundError(id);
      const normalized = normalizeAndValidateOtherInput(input, nowMs);
      const derived = deriveRecordFields({ type: 'other', eventTimeMs: normalized.eventTimeMs });
      await transaction.runAsync(`UPDATE records
        SET event_time_ms = ?, record_date = ?, sort_time_ms = ?, updated_at_ms = ?,
          note = ?, other_title = ?
        WHERE id = ? AND type = 'other'`,
      normalized.eventTimeMs, derived.recordDate, derived.sortTimeMs, nowMs,
      normalized.note, normalized.title, id);
      result = await getById(transaction, id);
    });
    if (!result) throw new OtherRecordNotFoundError(id);
    return result;
  }

  async delete(id: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new OtherRecordNotFoundError(id);
      await transaction.runAsync(`DELETE FROM records WHERE id = ? AND type = 'other'`, id);
    });
  }

  async listByDate(recordDate: string) {
    const rows = await this.database.getAllAsync<OtherRow>(`
      SELECT ${otherColumns} FROM records
      WHERE type = 'other' AND record_date = ?
      ORDER BY sort_time_ms DESC, created_at_ms DESC
    `, recordDate);
    return rows.map(mapRow);
  }
}

function createTransactionAdapter(database: SQLiteDatabase): OtherDatabase {
  const query: OtherQueryDatabase = {
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    getAllAsync: (sql, ...params) => database.getAllAsync(sql, ...params),
    runAsync: (sql, ...params) => database.runAsync(sql, ...params),
  };
  return {
    ...query,
    withExclusiveTransactionAsync: (task) =>
      database.withExclusiveTransactionAsync((transaction) => task({
        getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
        getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
        runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
      })),
  };
}

export function createSQLiteOtherRepository(database: SQLiteDatabase) {
  return new SQLiteOtherRepository(createTransactionAdapter(database), (payload) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload));
}
