import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  SleepRepository,
  StartSleepCommand,
} from '@/application/ports/sleep-repository';
import { getLocalDayBounds } from '@/domain/date/local-date';
import { IdempotencyConflictError } from '@/domain/records/idempotency';
import { deriveRecordFields } from '@/domain/records/record-derived-fields';
import type {
  ActiveSleepUpdateInput,
  CompletedSleepRecord,
  CompletedSleepUpdateInput,
  FinishSleepResult,
  SleepRecord,
  StartSleepResult,
} from '@/domain/sleep/sleep';
import { sumCompletedSleepOverlapMs } from '@/domain/sleep/sleep-statistics';
import {
  normalizeAndValidateCompletedSleepInput,
  normalizeAndValidateSleepStartInput,
  serializeSleepStartPayload,
} from '@/domain/sleep/sleep-validation';

export { IdempotencyConflictError } from '@/domain/records/idempotency';

type SQLiteValue = string | number | null;

type SleepRow = {
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
  sleep_start_ms: number;
  sleep_end_ms: number | null;
  sleep_status: 'sleeping' | 'completed';
};

export interface SleepQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface SleepDatabase extends SleepQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: SleepQueryDatabase) => Promise<void>): Promise<void>;
}

type HashPayload = (payload: string) => Promise<string>;

export class SleepRecordNotFoundError extends Error {
  constructor(readonly recordId: string) {
    super('睡眠记录不存在或已被删除');
    this.name = 'SleepRecordNotFoundError';
  }
}

export class SleepRecordStateError extends Error {
  constructor(readonly recordId: string, readonly expectedStatus: 'sleeping' | 'completed') {
    super(`睡眠记录当前状态不允许此操作，需要 ${expectedStatus}`);
    this.name = 'SleepRecordStateError';
  }
}

const sleepColumns = `
  id, client_request_id, create_payload_hash, type,
  event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note,
  sleep_start_ms, sleep_end_ms, sleep_status
`;

function mapRow(row: SleepRow): SleepRecord {
  if (row.type !== 'sleep') throw new SleepRecordNotFoundError(row.id);
  const base = {
    id: row.id,
    type: 'sleep' as const,
    clientRequestId: row.client_request_id,
    createPayloadHash: row.create_payload_hash,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    sortTimeMs: row.sort_time_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    startMs: row.sleep_start_ms,
    note: row.note,
  };
  if (row.sleep_status === 'completed' && row.sleep_end_ms !== null) {
    return { ...base, status: 'completed', endMs: row.sleep_end_ms };
  }
  return { ...base, status: 'sleeping', endMs: null };
}

async function getById(database: SleepQueryDatabase, id: string) {
  const row = await database.getFirstAsync<SleepRow>(
    `SELECT ${sleepColumns} FROM records WHERE id = ? AND type = 'sleep'`,
    id,
  );
  return row ? mapRow(row) : null;
}

async function getActive(database: SleepQueryDatabase) {
  const row = await database.getFirstAsync<SleepRow>(`
    SELECT ${sleepColumns} FROM records
    WHERE type = 'sleep' AND sleep_status = 'sleeping'
    LIMIT 1
  `);
  return row ? mapRow(row) : null;
}

async function getByClientRequestId(database: SleepQueryDatabase, clientRequestId: string) {
  return database.getFirstAsync<SleepRow>(
    `SELECT ${sleepColumns} FROM records WHERE client_request_id = ?`,
    clientRequestId,
  );
}

export class SQLiteSleepRepository implements SleepRepository {
  constructor(
    private readonly database: SleepDatabase,
    private readonly hashPayload: HashPayload,
  ) {}

  async start(command: StartSleepCommand): Promise<StartSleepResult> {
    const normalized = normalizeAndValidateSleepStartInput(command.input, command.nowMs);
    const payloadHash = await this.hashPayload(serializeSleepStartPayload(normalized));
    const derived = deriveRecordFields({ type: 'sleep', sleepStartMs: normalized.startMs, sleepEndMs: null });
    let result: StartSleepResult | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      try {
        await transaction.runAsync(
          `INSERT INTO records (
            id, client_request_id, create_payload_hash, type,
            event_time_ms, record_date, sort_time_ms,
            created_at_ms, updated_at_ms, note,
            sleep_start_ms, sleep_end_ms, sleep_status
          ) VALUES (?, ?, ?, 'sleep', ?, ?, ?, ?, ?, ?, ?, NULL, 'sleeping')`,
          command.id,
          command.clientRequestId,
          payloadHash,
          normalized.startMs,
          derived.recordDate,
          derived.sortTimeMs,
          command.nowMs,
          command.nowMs,
          normalized.note,
          normalized.startMs,
        );
        const created = await getById(transaction, command.id);
        if (!created) throw new Error('睡眠记录保存后无法读取');
        result = { record: created, outcome: 'created' };
      } catch (error) {
        const sameRequest = await getByClientRequestId(transaction, command.clientRequestId);
        if (sameRequest) {
          if (sameRequest.type !== 'sleep' || sameRequest.create_payload_hash !== payloadHash) {
            throw new IdempotencyConflictError(command.clientRequestId);
          }
          result = { record: mapRow(sameRequest), outcome: 'idempotent' };
          return;
        }
        const active = await getActive(transaction);
        if (active) {
          result = { record: active, outcome: 'already-active' };
          return;
        }
        throw error;
      }
    });

    if (!result) throw new Error('睡眠记录保存后无法读取');
    return result;
  }

  async getByClientRequestId(clientRequestId: string) {
    const row = await getByClientRequestId(this.database, clientRequestId);
    return row ? mapRow(row) : null;
  }

  getById(id: string) {
    return getById(this.database, id);
  }

  getActive() {
    return getActive(this.database);
  }

  async finish(id: string, endMs: number, nowMs: number, changes?: ActiveSleepUpdateInput): Promise<FinishSleepResult> {
    let result: FinishSleepResult | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new SleepRecordNotFoundError(id);
      if (existing.status === 'completed') {
        result = { record: existing, outcome: 'already-completed' };
        return;
      }
      const normalized = normalizeAndValidateCompletedSleepInput(
        { startMs: changes?.startMs ?? existing.startMs, endMs, note: changes ? changes.note : existing.note },
        nowMs,
      );
      const derived = deriveRecordFields({ type: 'sleep', sleepStartMs: normalized.startMs, sleepEndMs: normalized.endMs });
      await transaction.runAsync(
        `UPDATE records SET sleep_start_ms = ?, event_time_ms = ?, record_date = ?, sort_time_ms = ?, note = ?, sleep_end_ms = ?, sleep_status = 'completed', updated_at_ms = ?
         WHERE id = ? AND type = 'sleep' AND sleep_status = 'sleeping'`,
        normalized.startMs, normalized.startMs, derived.recordDate, derived.sortTimeMs, normalized.note,
        normalized.endMs,
        nowMs,
        id,
      );
      const persisted = await getById(transaction, id);
      if (!persisted) throw new SleepRecordNotFoundError(id);
      if (persisted.status !== 'completed') throw new SleepRecordStateError(id, 'completed');
      result = {
        record: persisted,
        outcome: persisted.endMs === normalized.endMs ? 'completed' : 'already-completed',
      };
    });
    if (!result) throw new SleepRecordNotFoundError(id);
    return result;
  }

  async updateActive(id: string, input: ActiveSleepUpdateInput, nowMs: number) {
    let result: SleepRecord | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new SleepRecordNotFoundError(id);
      if (existing.status !== 'sleeping') throw new SleepRecordStateError(id, 'sleeping');
      const normalized = normalizeAndValidateSleepStartInput(input, nowMs);
      const derived = deriveRecordFields({ type: 'sleep', sleepStartMs: normalized.startMs, sleepEndMs: null });
      await transaction.runAsync(
        `UPDATE records SET event_time_ms = ?, record_date = ?, sort_time_ms = ?,
          updated_at_ms = ?, note = ?, sleep_start_ms = ?
         WHERE id = ? AND type = 'sleep' AND sleep_status = 'sleeping'`,
        normalized.startMs, derived.recordDate, derived.sortTimeMs, nowMs,
        normalized.note, normalized.startMs, id,
      );
      result = await getById(transaction, id);
    });
    if (!result) throw new SleepRecordNotFoundError(id);
    return result;
  }

  async updateCompleted(id: string, input: CompletedSleepUpdateInput, nowMs: number) {
    let result: SleepRecord | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new SleepRecordNotFoundError(id);
      if (existing.status !== 'completed') throw new SleepRecordStateError(id, 'completed');
      const normalized = normalizeAndValidateCompletedSleepInput(input, nowMs);
      const derived = deriveRecordFields({
        type: 'sleep', sleepStartMs: normalized.startMs, sleepEndMs: normalized.endMs,
      });
      await transaction.runAsync(
        `UPDATE records SET event_time_ms = ?, record_date = ?, sort_time_ms = ?,
          updated_at_ms = ?, note = ?, sleep_start_ms = ?, sleep_end_ms = ?
         WHERE id = ? AND type = 'sleep' AND sleep_status = 'completed'`,
        normalized.startMs, derived.recordDate, derived.sortTimeMs, nowMs,
        normalized.note, normalized.startMs, normalized.endMs, id,
      );
      result = await getById(transaction, id);
    });
    if (!result) throw new SleepRecordNotFoundError(id);
    return result;
  }

  async delete(id: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new SleepRecordNotFoundError(id);
      await transaction.runAsync(`DELETE FROM records WHERE id = ? AND type = 'sleep'`, id);
    });
  }

  async listByStartDate(dateKey: string) {
    const rows = await this.database.getAllAsync<SleepRow>(`
      SELECT ${sleepColumns} FROM records
      WHERE type = 'sleep' AND record_date = ?
      ORDER BY sort_time_ms DESC, created_at_ms DESC
    `, dateKey);
    return rows.map(mapRow);
  }

  async listTimelineSources(dateKey: string) {
    const { startMs, endMs } = getLocalDayBounds(dateKey);
    const rows = await this.database.getAllAsync<SleepRow>(`
      SELECT ${sleepColumns} FROM records
      WHERE type = 'sleep' AND (
        record_date = ?
        OR (sleep_status = 'completed' AND sleep_end_ms >= ? AND sleep_end_ms < ?)
      )
      ORDER BY sort_time_ms DESC, created_at_ms DESC
    `, dateKey, startMs, endMs);
    return rows.map(mapRow);
  }

  async getDailyCompletedTotalMs(dateKey: string) {
    const { startMs, endMs } = getLocalDayBounds(dateKey);
    const rows = await this.database.getAllAsync<SleepRow>(`
      SELECT ${sleepColumns} FROM records
      WHERE type = 'sleep' AND sleep_status = 'completed'
        AND sleep_start_ms < ? AND sleep_end_ms > ?
    `, endMs, startMs);
    return sumCompletedSleepOverlapMs(rows.map((row) => {
      const record = mapRow(row) as CompletedSleepRecord;
      return { startMs: record.startMs, endMs: record.endMs, status: 'completed' as const };
    }), dateKey);
  }
}

function createTransactionAdapter(database: SQLiteDatabase): SleepDatabase {
  const query: SleepQueryDatabase = {
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

export function createSQLiteSleepRepository(database: SQLiteDatabase) {
  return new SQLiteSleepRepository(createTransactionAdapter(database), (payload) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
  );
}
