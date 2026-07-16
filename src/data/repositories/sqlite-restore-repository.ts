import type { SQLiteDatabase } from 'expo-sqlite';

import type { RestoreRepository } from '@/application/ports/backup';
import type { BackupData, BackupRecordType } from '@/domain/backup/backup-types';
import { countBackupRecords, validateBackupData } from '@/domain/backup/backup-validation';
import { isManagedPoopPhotoPath } from '@/data/photo/managed-photo-path';

type SQLiteValue = string | number | null;

export interface RestoreQueryDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface RestoreDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (transaction: RestoreQueryDatabase) => Promise<void>): Promise<void>;
}

const insertRecordSql = `INSERT INTO records (
  id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note, feeding_type, milk_amount_ml, left_duration_min,
  right_duration_min, poop_color, poop_texture, poop_amount, photo_uri, pee_color, pee_amount,
  sleep_start_ms, sleep_end_ms, sleep_status, other_title
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function expectedPhotoPaths(data: BackupData, photoPaths: ReadonlyMap<string, string>) {
  const expected = new Set<string>();
  for (const record of data.records) {
    if (!record.photo_backup_entry) continue;
    const relativePath = photoPaths.get(record.photo_backup_entry);
    if (!relativePath || !isManagedPoopPhotoPath(relativePath)) throw new Error('恢复照片目标路径无效');
    expected.add(record.photo_backup_entry);
  }
  if (photoPaths.size !== expected.size || [...photoPaths.keys()].some((key) => !expected.has(key))) {
    throw new Error('恢复照片映射与记录引用不一致');
  }
}

export class SQLiteRestoreRepository implements RestoreRepository {
  constructor(private readonly database: RestoreDatabase) {}

  async hasCurrentData() {
    const row = await this.database.getFirstAsync<{ count: number }>(`
      SELECT (SELECT COUNT(*) FROM baby) + (SELECT COUNT(*) FROM records) AS count
    `);
    return (row?.count ?? 0) > 0;
  }

  async listReferencedPhotoPaths() {
    return (await this.database.getAllAsync<{ photo_uri: string }>(`
      SELECT photo_uri FROM records WHERE type='poop' AND photo_uri IS NOT NULL ORDER BY photo_uri
    `)).map((row) => row.photo_uri);
  }

  async replaceAll(rawData: BackupData, photoPaths: ReadonlyMap<string, string>, restoredAtMs: number) {
    const data = validateBackupData(rawData);
    expectedPhotoPaths(data, photoPaths);
    const expectedCounts = countBackupRecords(data.records);
    const expectedIds = [...data.records.map((record) => record.id)].sort();

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM records');
      await transaction.runAsync('DELETE FROM baby');
      await transaction.runAsync(`INSERT INTO baby (
        id, singleton_key, name, birth_date, created_at_ms, updated_at_ms
      ) VALUES (?,1,?,?,?,?)`, data.baby.id, data.baby.name, data.baby.birth_date,
      data.baby.created_at_ms, data.baby.updated_at_ms);

      for (const record of data.records) {
        const photoUri = record.photo_backup_entry ? photoPaths.get(record.photo_backup_entry) ?? null : null;
        await transaction.runAsync(insertRecordSql,
          record.id, record.client_request_id, record.create_payload_hash, record.type,
          record.event_time_ms, record.record_date, record.sort_time_ms, record.created_at_ms,
          record.updated_at_ms, record.note, record.feeding_type, record.milk_amount_ml,
          record.left_duration_min, record.right_duration_min, record.poop_color,
          record.poop_texture, record.poop_amount, photoUri, record.pee_color, record.pee_amount,
          record.sleep_start_ms, record.sleep_end_ms, record.sleep_status, record.other_title);
      }

      await transaction.runAsync(`UPDATE app_settings SET
        theme_mode=?, feeding_reminder_minutes=?, scheduled_notification_id=NULL,
        feeding_reminder_scheduled_for_ms=NULL, feeding_reminder_source_record_id=NULL,
        feeding_reminder_sync_error_code=NULL, updated_at_ms=? WHERE singleton_key=1`,
      data.settings.theme_mode, data.settings.feeding_reminder_interval_minutes, restoredAtMs);

      const actualRows = await transaction.getAllAsync<{ type: BackupRecordType; count: number }>(`
        SELECT type, COUNT(*) AS count FROM records GROUP BY type
      `);
      const actualCounts: Record<BackupRecordType, number> = { feeding: 0, poop: 0, pee: 0, sleep: 0, other: 0 };
      for (const row of actualRows) actualCounts[row.type] = row.count;
      if (JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts)) throw new Error('恢复后的记录数量校验失败');

      const actualIds = (await transaction.getAllAsync<{ id: string }>('SELECT id FROM records ORDER BY id'))
        .map((row) => row.id);
      if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
        throw new Error('恢复后的记录ID校验失败');
      }
      const sleeping = await transaction.getFirstAsync<{ count: number }>(`
        SELECT COUNT(*) AS count FROM records WHERE type='sleep' AND sleep_status='sleeping'
      `);
      if ((sleeping?.count ?? 0) > 1) throw new Error('恢复后存在多条进行中睡眠');
      const integrity = await transaction.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
      if (integrity?.integrity_check !== 'ok') throw new Error('恢复后的SQLite完整性校验失败');
    });
  }
}

export function createSQLiteRestoreRepository(database: SQLiteDatabase) {
  return new SQLiteRestoreRepository({
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    getAllAsync: (sql, ...params) => database.getAllAsync(sql, ...params),
    withExclusiveTransactionAsync: (task) => database.withExclusiveTransactionAsync((transaction) => task({
      execAsync: (sql) => transaction.execAsync(sql),
      getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
      getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
      runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
    })),
  });
}
