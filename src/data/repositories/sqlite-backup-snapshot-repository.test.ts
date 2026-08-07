/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import { SQLiteBackupSnapshotRepository, type BackupSnapshotDatabase } from './sqlite-backup-snapshot-repository';

type Value = string | number | null;

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) { sqlite.exec(migration.sql); sqlite.exec(`PRAGMA user_version=${migration.version}`); }
  sqlite.prepare(`INSERT INTO baby (id, singleton_key, name, birth_date, created_at_ms, updated_at_ms)
    VALUES ('baby-1',1,'小宝','2026-06-01',1,2)`).run();
  sqlite.prepare(`UPDATE app_settings SET theme_mode='dark', feeding_reminder_minutes=120,
    scheduled_notification_id='native-secret', feeding_reminder_scheduled_for_ms=999,
    feeding_reminder_source_record_id='feeding-1', notification_permission_prompted=1,
    feeding_reminder_sync_error_code='schedule-failed', updated_at_ms=3`).run();
  const base = `id,client_request_id,create_payload_hash,type,event_time_ms,record_date,sort_time_ms,created_at_ms,updated_at_ms`;
  sqlite.prepare(`INSERT INTO records (${base},feeding_type,milk_amount_ml)
    VALUES ('feeding-1','request-1',?,'feeding',1000,'2026-07-10',1000,1000,1000,'formula',60)`).run('1'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base},feeding_type,breast_milk_amount_ml)
    VALUES ('feeding-bottle-breast','request-bottle-breast',?,'feeding',1500,'2026-07-10',1500,1500,1500,'bottle_breast',80)`).run('3'.repeat(64));
  sqlite.prepare(`INSERT INTO records (${base},poop_color,photo_uri)
    VALUES ('poop-1','request-2',?,'poop',2000,'2026-07-10',2000,2000,2000,'yellow','poop-photos/private.jpg')`).run('2'.repeat(64));
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
  };
  let exclusiveCalls = 0;
  const database: BackupSnapshotDatabase = {
    withExclusiveTransactionAsync: async (task) => { exclusiveCalls += 1; await task(query); },
  };
  return { sqlite, repository: new SQLiteBackupSnapshotRepository(database), exclusiveCalls: () => exclusiveCalls };
}

describe('SQLiteBackupSnapshotRepository', () => {
  test('reads baby, all trusted record fields, and settings allowlist in one exclusive snapshot', async () => {
    const { sqlite, repository, exclusiveCalls } = setup();
    const snapshot = await repository.getSnapshot();
    expect(exclusiveCalls()).toBe(1);
    expect(snapshot.sourceSchemaVersion).toBe(9);
    expect(snapshot.baby).toEqual({ id: 'baby-1', name: '小宝', birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 2 });
    expect(snapshot.records).toEqual([
      expect.objectContaining({ id: 'feeding-1', client_request_id: 'request-1', feeding_type: 'formula', milk_amount_ml: 60, source_photo_path: null }),
      expect.objectContaining({ id: 'feeding-bottle-breast', feeding_type: 'bottle_breast', breast_milk_amount_ml: 80, source_photo_path: null }),
      expect.objectContaining({ id: 'poop-1', source_photo_path: 'poop-photos/private.jpg' }),
    ]);
    expect(snapshot.settings).toEqual({ theme_mode: 'dark', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 120 });
    expect(JSON.stringify(snapshot)).not.toContain('native-secret');
    expect(JSON.stringify(snapshot)).not.toContain('schedule-failed');
    sqlite.close();
  });
});
