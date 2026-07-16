import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CreatePoopCommand,
  PoopRepository,
  UpdatePoopPersistenceInput,
} from '@/application/ports/poop-repository';
import { isManagedPoopPhotoPath } from '@/data/photo/managed-photo-path';
import type { PoopAmount, PoopColor, PoopRecord, PoopTexture } from '@/domain/poop/poop';
import {
  normalizeAndValidatePoopInput,
  serializePoopCreatePayload,
} from '@/domain/poop/poop-validation';
import { deriveRecordFields } from '@/domain/records/record-derived-fields';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

export { IdempotencyConflictError } from '@/domain/records/idempotency';

type SQLiteValue = string | number | null;
type StoredPoopTexture = 'watery' | 'loose' | 'pasty' | 'formed' | 'pellet';

type PoopRow = {
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
  poop_color: PoopColor | null;
  poop_texture: StoredPoopTexture | null;
  poop_amount: PoopAmount | null;
  photo_uri: string | null;
};

export interface PoopQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface PoopDatabase extends PoopQueryDatabase {
  withExclusiveTransactionAsync(task: (transaction: PoopQueryDatabase) => Promise<void>): Promise<void>;
}

type HashPayload = (payload: string) => Promise<string>;

export class PoopRecordNotFoundError extends Error {
  constructor(readonly recordId: string) {
    super('大便记录不存在或已被删除');
    this.name = 'PoopRecordNotFoundError';
  }
}

const columns = `
  id, client_request_id, create_payload_hash, type,
  event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note,
  poop_color, poop_texture, poop_amount, photo_uri
`;

function toStoredTexture(value: PoopTexture | null): StoredPoopTexture | null {
  if (value === 'soft') return 'loose';
  if (value === 'mushy') return 'pasty';
  return value;
}

function fromStoredTexture(value: StoredPoopTexture | null): PoopTexture | null {
  if (value === 'loose') return 'soft';
  if (value === 'pasty') return 'mushy';
  return value;
}

function mapRow(row: PoopRow): PoopRecord {
  if (row.type !== 'poop') throw new PoopRecordNotFoundError(row.id);
  return {
    id: row.id,
    type: 'poop',
    clientRequestId: row.client_request_id,
    createPayloadHash: row.create_payload_hash,
    eventTimeMs: row.event_time_ms,
    recordDate: row.record_date,
    sortTimeMs: row.sort_time_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    note: row.note,
    color: row.poop_color,
    texture: fromStoredTexture(row.poop_texture),
    amount: row.poop_amount,
    photoUri: row.photo_uri,
  };
}

async function getById(database: PoopQueryDatabase, id: string) {
  const row = await database.getFirstAsync<PoopRow>(`SELECT ${columns} FROM records WHERE id = ?`, id);
  return row ? mapRow(row) : null;
}

async function getByClientRequestId(database: PoopQueryDatabase, clientRequestId: string) {
  return database.getFirstAsync<PoopRow>(
    `SELECT ${columns} FROM records WHERE client_request_id = ?`,
    clientRequestId,
  );
}

function assertManagedPhotoPath(photoUri: string | null) {
  if (photoUri !== null && !isManagedPoopPhotoPath(photoUri)) {
    throw new Error('大便照片必须位于 App 受管理目录');
  }
}

export class SQLitePoopRepository implements PoopRepository {
  constructor(
    private readonly database: PoopDatabase,
    private readonly hashPayload: HashPayload,
  ) {}

  async create(command: CreatePoopCommand): Promise<PoopRecord> {
    const normalized = normalizeAndValidatePoopInput(command.input, command.nowMs);
    assertManagedPhotoPath(command.photoUri);
    if ((command.photoUri === null) !== (command.photoContentFingerprint === null)) {
      throw new Error('照片路径与内容指纹必须同时存在或同时为空');
    }
    const payloadHash = await this.hashPayload(
      serializePoopCreatePayload(normalized, command.photoUri, command.photoContentFingerprint),
    );
    const derived = deriveRecordFields({ type: 'poop', eventTimeMs: normalized.eventTimeMs });
    let result: PoopRecord | null = null;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      try {
        await transaction.runAsync(
          `
            INSERT INTO records (
              id, client_request_id, create_payload_hash, type,
              event_time_ms, record_date, sort_time_ms,
              created_at_ms, updated_at_ms, note,
              poop_color, poop_texture, poop_amount, photo_uri
            ) VALUES (?, ?, ?, 'poop', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          normalized.color,
          toStoredTexture(normalized.texture),
          normalized.amount,
          command.photoUri,
        );
      } catch (error) {
        const existing = await getByClientRequestId(transaction, command.clientRequestId);
        if (!existing) throw error;
        if (existing.type !== 'poop' || existing.create_payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(command.clientRequestId);
        }
        result = mapRow(existing);
        return;
      }
      result = await getById(transaction, command.id);
    });

    if (!result) throw new Error('大便记录保存后无法读取');
    return result;
  }

  getById(id: string) {
    return getById(this.database, id);
  }

  async getByClientRequestId(clientRequestId: string) {
    const row = await getByClientRequestId(this.database, clientRequestId);
    if (!row) return null;
    if (row.type !== 'poop') throw new IdempotencyConflictError(clientRequestId);
    return mapRow(row);
  }

  async update(id: string, input: UpdatePoopPersistenceInput, nowMs: number): Promise<PoopRecord> {
    const normalized = normalizeAndValidatePoopInput(input, nowMs);
    assertManagedPhotoPath(input.photoUri);
    let result: PoopRecord | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new PoopRecordNotFoundError(id);
      const derived = deriveRecordFields({ type: 'poop', eventTimeMs: normalized.eventTimeMs });
      await transaction.runAsync(
        `
          UPDATE records
          SET event_time_ms = ?, record_date = ?, sort_time_ms = ?, updated_at_ms = ?,
              note = ?, poop_color = ?, poop_texture = ?, poop_amount = ?, photo_uri = ?
          WHERE id = ? AND type = 'poop'
        `,
        normalized.eventTimeMs,
        derived.recordDate,
        derived.sortTimeMs,
        nowMs,
        normalized.note,
        normalized.color,
        toStoredTexture(normalized.texture),
        normalized.amount,
        input.photoUri,
        id,
      );
      result = await getById(transaction, id);
    });
    if (!result) throw new PoopRecordNotFoundError(id);
    return result;
  }

  async delete(id: string) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await getById(transaction, id);
      if (!existing) throw new PoopRecordNotFoundError(id);
      await transaction.runAsync(`DELETE FROM records WHERE id = ? AND type = 'poop'`, id);
    });
  }

  async listByDate(recordDate: string) {
    const rows = await this.database.getAllAsync<PoopRow>(
      `SELECT ${columns} FROM records WHERE type = 'poop' AND record_date = ? ORDER BY sort_time_ms DESC, created_at_ms DESC`,
      recordDate,
    );
    return rows.map(mapRow);
  }

  async getDailyCount(recordDate: string) {
    const row = await this.database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM records WHERE type = 'poop' AND record_date = ?`,
      recordDate,
    );
    return row?.count ?? 0;
  }

  async listReferencedPhotoPaths() {
    const rows = await this.database.getAllAsync<{ photo_uri: string }>(
      `SELECT photo_uri FROM records WHERE type = 'poop' AND photo_uri IS NOT NULL`,
    );
    return rows.map((row) => row.photo_uri);
  }
}

function createTransactionAdapter(database: SQLiteDatabase): PoopDatabase {
  const query: PoopQueryDatabase = {
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

export function createSQLitePoopRepository(database: SQLiteDatabase) {
  return new SQLitePoopRepository(createTransactionAdapter(database), (payload) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
  );
}
