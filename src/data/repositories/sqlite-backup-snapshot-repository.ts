import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  BackupSnapshot,
  BackupSnapshotRepository,
  BackupSourceRecord,
} from '@/application/ports/backup';
import type { BackupBaby, BackupSettings } from '@/domain/backup/backup-types';

type SQLiteValue = string | number | null;

type SettingsRow = { theme_mode: BackupSettings['theme_mode']; feeding_reminder_minutes: number | null };
type VersionRow = { user_version: number };
type RecordRow = Omit<BackupSourceRecord, 'source_photo_path'> & { photo_uri: string | null };

export interface BackupSnapshotQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
}

export interface BackupSnapshotDatabase {
  withExclusiveTransactionAsync(task: (transaction: BackupSnapshotQueryDatabase) => Promise<void>): Promise<void>;
}

const recordColumns = `
  id, client_request_id, create_payload_hash, type, event_time_ms, record_date, sort_time_ms,
  created_at_ms, updated_at_ms, note, feeding_type, milk_amount_ml, breast_milk_amount_ml, left_duration_min,
  right_duration_min, poop_color, poop_texture, poop_amount, photo_uri, pee_color, pee_amount,
  sleep_start_ms, sleep_end_ms, sleep_status, other_title
`;

function mapRecord(row: RecordRow): BackupSourceRecord {
  const { photo_uri, ...record } = row;
  return { ...record, source_photo_path: photo_uri };
}

export class SQLiteBackupSnapshotRepository implements BackupSnapshotRepository {
  constructor(private readonly database: BackupSnapshotDatabase) {}

  async getSnapshot(): Promise<BackupSnapshot> {
    let snapshot: BackupSnapshot | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const [version, baby, settings, records] = await Promise.all([
        transaction.getFirstAsync<VersionRow>('PRAGMA user_version'),
        transaction.getFirstAsync<BackupBaby>(`
          SELECT id, name, birth_date, created_at_ms, updated_at_ms FROM baby WHERE singleton_key=1
        `),
        transaction.getFirstAsync<SettingsRow>(`
          SELECT theme_mode, feeding_reminder_minutes FROM app_settings WHERE singleton_key=1
        `),
        transaction.getAllAsync<RecordRow>(`
          SELECT ${recordColumns} FROM records ORDER BY created_at_ms ASC, id ASC
        `),
      ]);
      if (!version || !baby || !settings) throw new Error('完整备份所需的本地数据不完整');
      snapshot = {
        sourceSchemaVersion: version.user_version,
        baby,
        records: records.map(mapRecord),
        settings: {
          theme_mode: settings.theme_mode,
          feeding_reminder_enabled: settings.feeding_reminder_minutes !== null,
          feeding_reminder_interval_minutes: settings.feeding_reminder_minutes,
        },
      };
    });
    if (!snapshot) throw new Error('无法读取完整备份快照');
    return snapshot;
  }
}

export function createSQLiteBackupSnapshotRepository(database: SQLiteDatabase) {
  return new SQLiteBackupSnapshotRepository({
    withExclusiveTransactionAsync: (task) => database.withExclusiveTransactionAsync((transaction) => task({
      getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
      getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
    })),
  });
}
