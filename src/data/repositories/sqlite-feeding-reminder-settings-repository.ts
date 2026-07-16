import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  FeedingReminderMetadata,
  FeedingReminderSettings,
  FeedingReminderSettingsRepository,
  FeedingReminderSyncErrorCode,
} from '@/application/ports/feeding-reminder';
import { validateFeedingReminderInterval } from '@/domain/reminders/feeding-reminder-planner';

type SQLiteValue = string | number | null;

type SettingsRow = {
  feeding_reminder_minutes: number | null;
  scheduled_notification_id: string | null;
  feeding_reminder_scheduled_for_ms: number | null;
  feeding_reminder_source_record_id: string | null;
  notification_permission_prompted: number;
  feeding_reminder_sync_error_code: FeedingReminderSyncErrorCode | null;
  updated_at_ms: number;
};

export interface ReminderSettingsQueryDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface ReminderSettingsDatabase extends ReminderSettingsQueryDatabase {
  withExclusiveTransactionAsync(
    task: (transaction: ReminderSettingsQueryDatabase) => Promise<void>,
  ): Promise<void>;
}

const settingsColumns = `
  feeding_reminder_minutes, scheduled_notification_id,
  feeding_reminder_scheduled_for_ms, feeding_reminder_source_record_id,
  notification_permission_prompted, feeding_reminder_sync_error_code, updated_at_ms
`;

function mapRow(row: SettingsRow): FeedingReminderSettings {
  return {
    intervalMinutes: row.feeding_reminder_minutes,
    notificationId: row.scheduled_notification_id,
    scheduledForMs: row.feeding_reminder_scheduled_for_ms,
    sourceRecordId: row.feeding_reminder_source_record_id,
    permissionPrompted: row.notification_permission_prompted === 1,
    syncErrorCode: row.feeding_reminder_sync_error_code,
    updatedAtMs: row.updated_at_ms,
  };
}

export class SQLiteFeedingReminderSettingsRepository implements FeedingReminderSettingsRepository {
  constructor(private readonly database: ReminderSettingsDatabase) {}

  async get() {
    const row = await this.database.getFirstAsync<SettingsRow>(
      `SELECT ${settingsColumns} FROM app_settings WHERE singleton_key=1`,
    );
    if (!row) throw new Error('提醒设置不存在');
    return mapRow(row);
  }

  async setInterval(intervalMinutes: number | null, nowMs: number) {
    if (intervalMinutes !== null) validateFeedingReminderInterval(intervalMinutes);
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      if (intervalMinutes === null) {
        await transaction.runAsync(`UPDATE app_settings
          SET feeding_reminder_minutes=NULL, scheduled_notification_id=NULL,
            feeding_reminder_scheduled_for_ms=NULL, feeding_reminder_source_record_id=NULL,
            feeding_reminder_sync_error_code=NULL, updated_at_ms=?
          WHERE singleton_key=1`, nowMs);
      } else {
        await transaction.runAsync(`UPDATE app_settings
          SET feeding_reminder_minutes=?, feeding_reminder_sync_error_code=NULL, updated_at_ms=?
          WHERE singleton_key=1`, intervalMinutes, nowMs);
      }
    });
  }

  async markPermissionPrompted(nowMs: number) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE app_settings
        SET notification_permission_prompted=1, updated_at_ms=? WHERE singleton_key=1`, nowMs);
    });
  }

  async saveMetadata(metadata: FeedingReminderMetadata, nowMs: number) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE app_settings
        SET scheduled_notification_id=?, feeding_reminder_scheduled_for_ms=?,
          feeding_reminder_source_record_id=?, feeding_reminder_sync_error_code=NULL,
          updated_at_ms=? WHERE singleton_key=1`,
      metadata.notificationId, metadata.scheduledForMs, metadata.sourceRecordId, nowMs);
    });
  }

  async clearMetadata(errorCode: FeedingReminderSyncErrorCode | null, nowMs: number) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE app_settings
        SET scheduled_notification_id=NULL, feeding_reminder_scheduled_for_ms=NULL,
          feeding_reminder_source_record_id=NULL, feeding_reminder_sync_error_code=?,
          updated_at_ms=? WHERE singleton_key=1`, errorCode, nowMs);
    });
  }

  async setSyncError(errorCode: FeedingReminderSyncErrorCode, nowMs: number) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE app_settings
        SET feeding_reminder_sync_error_code=?, updated_at_ms=? WHERE singleton_key=1`,
      errorCode, nowMs);
    });
  }
}

function createDatabaseAdapter(database: SQLiteDatabase): ReminderSettingsDatabase {
  const query: ReminderSettingsQueryDatabase = {
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    runAsync: (sql, ...params) => database.runAsync(sql, ...params),
  };
  return {
    ...query,
    withExclusiveTransactionAsync: (task) =>
      database.withExclusiveTransactionAsync((transaction) => task({
        getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
        runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
      })),
  };
}

export function createSQLiteFeedingReminderSettingsRepository(database: SQLiteDatabase) {
  return new SQLiteFeedingReminderSettingsRepository(createDatabaseAdapter(database));
}
