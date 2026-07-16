/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import type { BackupData } from '@/domain/backup/backup-types';
import { validateBackupData } from '@/domain/backup/backup-validation';
import { SQLiteRestoreRepository, type RestoreDatabase } from './sqlite-restore-repository';

type Value = string | number | null;

function data(): BackupData {
  return validateBackupData({
    baby: { id: 'restored-baby', name: '恢复宝宝', birth_date: '2026-06-01', created_at_ms: 10, updated_at_ms: 20 },
    records: [
      {
        id: 'historical-sleep', client_request_id: 'historical-request', create_payload_hash: 'a'.repeat(64),
        type: 'sleep', event_time_ms: 18_000_000, record_date: '1969-12-31', sort_time_ms: 18_000_000,
        created_at_ms: 30, updated_at_ms: 40, note: null, feeding_type: null, milk_amount_ml: null,
        left_duration_min: null, right_duration_min: null, poop_color: null, poop_texture: null, poop_amount: null,
        photo_backup_entry: null, photo_sha256: null, pee_color: null, pee_amount: null,
        sleep_start_ms: 18_000_000, sleep_end_ms: 21_600_000, sleep_status: 'completed', other_title: null,
      },
      {
        id: 'restored-poop', client_request_id: 'restored-poop-request', create_payload_hash: 'b'.repeat(64),
        type: 'poop', event_time_ms: 50_000, record_date: '2026-07-10', sort_time_ms: 50_000,
        created_at_ms: 50, updated_at_ms: 60, note: '照片', feeding_type: null, milk_amount_ml: null,
        left_duration_min: null, right_duration_min: null, poop_color: 'yellow', poop_texture: null, poop_amount: null,
        photo_backup_entry: 'photos/photo-1.jpg', photo_sha256: 'c'.repeat(64), pee_color: null, pee_amount: null,
        sleep_start_ms: null, sleep_end_ms: null, sleep_status: null, other_title: null,
      },
    ],
    settings: { theme_mode: 'light', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 180 },
  });
}

function setup(failPattern?: RegExp) {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) { sqlite.exec(migration.sql); sqlite.exec(`PRAGMA user_version=${migration.version}`); }
  sqlite.exec(`INSERT INTO baby (id,singleton_key,name,birth_date,created_at_ms,updated_at_ms)
    VALUES ('old-baby',1,'旧宝宝','2026-01-01',1,1)`);
  sqlite.prepare(`INSERT INTO records (id,client_request_id,create_payload_hash,type,event_time_ms,
    record_date,sort_time_ms,created_at_ms,updated_at_ms,other_title)
    VALUES ('old-record','old-request',?,'other',1,'2026-01-01',1,1,1,'旧记录')`).run('d'.repeat(64));
  sqlite.exec(`UPDATE app_settings SET theme_mode='dark',feeding_reminder_minutes=120,
    scheduled_notification_id='old-native',feeding_reminder_scheduled_for_ms=999,
    feeding_reminder_source_record_id='old-record',notification_permission_prompted=1,
    feeding_reminder_sync_error_code='schedule-failed',updated_at_ms=1`);
  const query = {
    execAsync: async (sql: string) => { if (failPattern?.test(sql)) throw new Error('Injected restore failure'); sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) => {
      if (failPattern?.test(sql)) throw new Error('Injected restore failure');
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => {
      if (failPattern?.test(sql)) throw new Error('Injected restore failure');
      return sqlite.prepare(sql).all(...params) as T[];
    },
    runAsync: async (sql: string, ...params: Value[]) => {
      if (failPattern?.test(sql)) throw new Error('Injected restore failure');
      return sqlite.prepare(sql).run(...params);
    },
  };
  const database: RestoreDatabase = {
    getFirstAsync: query.getFirstAsync,
    getAllAsync: query.getAllAsync,
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(query); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, repository: new SQLiteRestoreRepository(database) };
}

describe('SQLiteRestoreRepository trusted replacement', () => {
  test('replaces instead of merging and preserves historical identity, dates, and timestamps', async () => {
    const { sqlite, repository } = setup();
    await repository.replaceAll(data(), new Map([['photos/photo-1.jpg', 'poop-photos/restore-session-photo.jpg']]), 70);
    expect(sqlite.prepare(`SELECT id,name,birth_date,created_at_ms,updated_at_ms FROM baby`).get()).toEqual({
      id: 'restored-baby', name: '恢复宝宝', birth_date: '2026-06-01', created_at_ms: 10, updated_at_ms: 20,
    });
    expect(sqlite.prepare(`SELECT id,client_request_id,event_time_ms,record_date,sort_time_ms,
      created_at_ms,updated_at_ms,sleep_start_ms,sleep_end_ms FROM records WHERE id='historical-sleep'`).get()).toEqual({
      id: 'historical-sleep', client_request_id: 'historical-request', event_time_ms: 18_000_000,
      record_date: '1969-12-31', sort_time_ms: 18_000_000, created_at_ms: 30, updated_at_ms: 40,
      sleep_start_ms: 18_000_000, sleep_end_ms: 21_600_000,
    });
    expect(sqlite.prepare(`SELECT photo_uri FROM records WHERE id='restored-poop'`).get())
      .toEqual({ photo_uri: 'poop-photos/restore-session-photo.jpg' });
    expect(sqlite.prepare(`SELECT COUNT(*) count FROM records WHERE id='old-record'`).get()).toEqual({ count: 0 });
    expect(sqlite.prepare(`SELECT theme_mode,feeding_reminder_minutes,scheduled_notification_id,
      feeding_reminder_scheduled_for_ms,feeding_reminder_source_record_id,feeding_reminder_sync_error_code,
      notification_permission_prompted FROM app_settings`).get()).toEqual({
      theme_mode: 'light', feeding_reminder_minutes: 180, scheduled_notification_id: null,
      feeding_reminder_scheduled_for_ms: null, feeding_reminder_source_record_id: null,
      feeding_reminder_sync_error_code: null, notification_permission_prompted: 1,
    });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test('rejects an invalid managed photo mapping before changing data', async () => {
    const { sqlite, repository } = setup();
    await expect(repository.replaceAll(data(), new Map([['photos/photo-1.jpg', '../escape.jpg']]), 70)).rejects.toThrow();
    expect(sqlite.prepare(`SELECT id FROM baby`).get()).toEqual({ id: 'old-baby' });
    expect(sqlite.prepare(`SELECT id FROM records`).get()).toEqual({ id: 'old-record' });
    sqlite.close();
  });

  test.each([/DELETE FROM records/i, /INSERT INTO records/i, /GROUP BY type/i, /PRAGMA integrity_check/i])(
    'rolls back original baby, records, and settings when transaction fails at %s',
    async (pattern) => {
      const { sqlite, repository } = setup(pattern);
      await expect(repository.replaceAll(data(), new Map([['photos/photo-1.jpg', 'poop-photos/new.jpg']]), 70))
        .rejects.toThrow('Injected restore failure');
      expect(sqlite.prepare(`SELECT id FROM baby`).get()).toEqual({ id: 'old-baby' });
      expect(sqlite.prepare(`SELECT id FROM records`).get()).toEqual({ id: 'old-record' });
      expect(sqlite.prepare(`SELECT theme_mode,feeding_reminder_minutes,scheduled_notification_id FROM app_settings`).get())
        .toEqual({ theme_mode: 'dark', feeding_reminder_minutes: 120, scheduled_notification_id: 'old-native' });
      sqlite.close();
    },
  );
});
