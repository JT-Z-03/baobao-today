/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import type { BackupData } from '@/domain/backup/backup-types';
import { validateBackupData } from '@/domain/backup/backup-validation';
import { createSQLiteRestoreRepository, SQLiteRestoreRepository, type RestoreDatabase } from './sqlite-restore-repository';

type Value = string | number | null;

function data(): BackupData {
  return validateBackupData({
    baby: { id: 'restored-baby', name: '恢复宝宝', birth_date: '2026-06-01', created_at_ms: 10, updated_at_ms: 20 },
    records: [
      {
        id: 'historical-sleep', client_request_id: 'historical-request', create_payload_hash: 'a'.repeat(64),
        type: 'sleep', event_time_ms: 18_000_000, record_date: '1969-12-31', sort_time_ms: 18_000_000,
        created_at_ms: 30, updated_at_ms: 40, note: null, feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null,
        left_duration_min: null, right_duration_min: null, poop_color: null, poop_texture: null, poop_amount: null,
        photo_backup_entry: null, photo_sha256: null, pee_color: null, pee_amount: null,
        sleep_start_ms: 18_000_000, sleep_end_ms: 21_600_000, sleep_status: 'completed', other_title: null,
      },
      {
        id: 'restored-poop', client_request_id: 'restored-poop-request', create_payload_hash: 'b'.repeat(64),
        type: 'poop', event_time_ms: 50_000, record_date: '2026-07-10', sort_time_ms: 50_000,
        created_at_ms: 50, updated_at_ms: 60, note: '照片', feeding_type: null, milk_amount_ml: null, breast_milk_amount_ml: null,
        left_duration_min: null, right_duration_min: null, poop_color: 'yellow', poop_texture: null, poop_amount: null,
        photo_backup_entry: 'photos/photo-1.jpg', photo_sha256: 'c'.repeat(64), pee_color: null, pee_amount: null,
        sleep_start_ms: null, sleep_end_ms: null, sleep_status: null, other_title: null,
      },
    ],
    settings: { theme_mode: 'light', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 180 },
  });
}

function dataWithBottledBreastMilk(): BackupData {
  const backup = data();
  return {
    ...backup,
    records: [...backup.records, {
      id: 'restored-bottle-breast', client_request_id: 'restored-bottle-breast-request', create_payload_hash: 'e'.repeat(64),
      type: 'feeding', event_time_ms: 70_000, record_date: '2026-07-10', sort_time_ms: 70_000,
      created_at_ms: 70, updated_at_ms: 80, note: null, feeding_type: 'bottle_breast', milk_amount_ml: null,
      breast_milk_amount_ml: 80, left_duration_min: null, right_duration_min: null, poop_color: null,
      poop_texture: null, poop_amount: null, photo_backup_entry: null, photo_sha256: null, pee_color: null,
      pee_amount: null, sleep_start_ms: null, sleep_end_ms: null, sleep_status: null, other_title: null,
    }],
  };
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
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  test('restores bottled breast milk amount into SQLite', async () => {
    const { sqlite, repository } = setup();
    await repository.replaceAll(
      dataWithBottledBreastMilk(),
      new Map([['photos/photo-1.jpg', 'poop-photos/restore-session-photo.jpg']]),
      70,
    );
    expect(sqlite.prepare(`SELECT feeding_type, breast_milk_amount_ml FROM records
      WHERE id='restored-bottle-breast'`).get()).toEqual({ feeding_type: 'bottle_breast', breast_milk_amount_ml: 80 });
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

function allRecordTypes(): BackupData {
  const backup = dataWithBottledBreastMilk();
  const empty = { ...backup.records[2], feeding_type: null, breast_milk_amount_ml: null };
  return {
    ...backup,
    records: [
      { ...backup.records[0], note: '历史睡眠😀' },
      { ...backup.records[1], poop_texture: 'pasty', poop_amount: 'large' },
      backup.records[2],
      { ...empty, id: 'restored-pee', client_request_id: 'pee-request', type: 'pee',
        pee_color: 'dark-yellow', pee_amount: 'small' },
      { ...empty, id: 'restored-mixed', client_request_id: 'mixed-request', type: 'feeding',
        feeding_type: 'mixed', milk_amount_ml: 31, breast_milk_amount_ml: 47,
        left_duration_min: 5, right_duration_min: 7, note: '混合喂养' },
      { ...empty, id: 'restored-other', client_request_id: 'other-request', type: 'other', other_title: '洗澡' },
      { ...empty, id: 'restored-empty-poop', client_request_id: 'empty-poop-request', type: 'poop' },
    ],
  };
}

type FactoryFailure = 'prepare' | 'second-execute' | 'finalize' | 'settings' | 'counts' | 'ids' | 'integrity';

function factorySetup(options: {
  failure?: FactoryFailure;
  error?: Error;
  finalizeError?: Error;
  beforeFinalize?(): Promise<void>;
} = {}) {
  const { sqlite } = setup();
  const events: string[] = [];
  const statements: { bindings: Value[][]; finalizeCalls: number }[] = [];
  const statistics = { prepareCalls: 0, directRecordWrites: 0 };
  const failure = options.error ?? new Error('Injected factory failure');
  const fail = (point: FactoryFailure) => { if (options.failure === point) throw failure; };
  const snapshot = () => ({
    baby: sqlite.prepare('SELECT * FROM baby').all(),
    records: sqlite.prepare('SELECT * FROM records ORDER BY id').all(),
    settings: sqlite.prepare('SELECT * FROM app_settings').all(),
  });
  const original = snapshot();
  const query = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...params: Value[]) => {
      if (sql === 'PRAGMA integrity_check') { events.push('integrity'); fail('integrity'); }
      else events.push('sleeping');
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllAsync: async <T,>(sql: string, ...params: Value[]) => {
      if (sql.includes('GROUP BY type')) { events.push('counts'); fail('counts'); }
      else if (sql === 'SELECT id FROM records ORDER BY id') { events.push('ids'); fail('ids'); }
      return sqlite.prepare(sql).all(...params) as T[];
    },
    runAsync: async (sql: string, ...params: Value[]) => {
      if (sql.startsWith('INSERT INTO records')) statistics.directRecordWrites += 1;
      if (sql.startsWith('UPDATE app_settings')) { events.push('settings'); fail('settings'); }
      return sqlite.prepare(sql).run(...params);
    },
    prepareAsync: async (sql: string) => {
      statistics.prepareCalls += 1;
      events.push('prepare');
      fail('prepare');
      const statement = sqlite.prepare(sql);
      const calls = { bindings: [] as Value[][], finalizeCalls: 0 };
      statements.push(calls);
      let released = false;
      return {
        executeAsync: async (...params: Value[]) => {
          if (released) throw new Error('Statement reused after release');
          calls.bindings.push(params);
          events.push('execute');
          if (calls.bindings.length === 2) fail('second-execute');
          return statement.run(...params);
        },
        // Node StatementSync has no finalize API. This controlled async substitute
        // tests our lifecycle/error boundary; real SQL and rollback still run above.
        finalizeAsync: async () => {
          calls.finalizeCalls += 1;
          if (released) throw new Error('Statement released twice');
          released = true;
          events.push('finalize-start');
          await options.beforeFinalize?.();
          fail('finalize');
          if (options.finalizeError) throw options.finalizeError;
          events.push('finalize-done');
        },
      };
    },
  };
  const database = {
    ...query,
    withExclusiveTransactionAsync: async (task: (transaction: typeof query) => Promise<void>) => {
      sqlite.exec('BEGIN IMMEDIATE');
      events.push('begin');
      try { await task(query); sqlite.exec('COMMIT'); events.push('commit'); }
      catch (error) { sqlite.exec('ROLLBACK'); events.push('rollback'); throw error; }
    },
  };
  const repository = createSQLiteRestoreRepository(database as unknown as SQLiteDatabase);
  return { sqlite, repository, events, statements, statistics, snapshot, original };
}

const restoredPhotos = new Map([['photos/photo-1.jpg', 'poop-photos/restore-session-photo.jpg']]);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('native restore factory statement lifecycle', () => {
  test('reuses one statement for all five record types without retaining any prior-row bindings', async () => {
    const value = factorySetup();
    const backup = allRecordTypes();
    try {
      await value.repository.replaceAll(backup, restoredPhotos, 90);
      const actual = value.sqlite.prepare('SELECT * FROM records').all() as Record<string, Value>[];
      const expected = backup.records.map(({ photo_backup_entry, photo_sha256: _hash, ...fields }) => ({
        ...fields, photo_uri: photo_backup_entry ? 'poop-photos/restore-session-photo.jpg' : null,
      }));
      expect(Object.fromEntries(actual.map((row) => [row.id, row])))
        .toEqual(Object.fromEntries(expected.map((row) => [row.id, row])));
      expect(actual.every((row) => Object.keys(row).length === 25)).toBe(true);
      expect(value.statistics).toEqual({ prepareCalls: 1, directRecordWrites: 0 });
      expect(value.statements).toHaveLength(1);
      expect(value.statements[0].bindings).toHaveLength(7);
      expect(value.statements[0].bindings.every((params) => params.length === 25)).toBe(true);
      expect(value.statements[0].finalizeCalls).toBe(1);
      expect(value.events).toEqual(['begin', 'prepare', ...Array(7).fill('execute'),
        'finalize-start', 'finalize-done', 'settings', 'counts', 'ids', 'sleeping', 'integrity', 'commit']);
      expect(value.sqlite.prepare('SELECT id,name FROM baby').get())
        .toEqual({ id: 'restored-baby', name: '恢复宝宝' });
      expect(value.sqlite.prepare('SELECT theme_mode,feeding_reminder_minutes,updated_at_ms FROM app_settings').get())
        .toEqual({ theme_mode: 'light', feeding_reminder_minutes: 180, updated_at_ms: 90 });
    } finally { value.sqlite.close(); }
  });

  test('empty records skip statement preparation while still replacing baby and settings', async () => {
    const value = factorySetup({ failure: 'prepare' });
    try {
      await value.repository.replaceAll({ ...data(), records: [] }, new Map(), 90);
      expect(value.statistics).toEqual({ prepareCalls: 0, directRecordWrites: 0 });
      expect(value.statements).toEqual([]);
      expect(value.sqlite.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 0 });
      expect(value.sqlite.prepare('SELECT id FROM baby').get()).toEqual({ id: 'restored-baby' });
      expect(value.sqlite.prepare('SELECT theme_mode FROM app_settings').get()).toEqual({ theme_mode: 'light' });
      expect(value.events.at(-1)).toBe('commit');
    } finally { value.sqlite.close(); }
  });

  test('a later transaction gets its own statement and can bind nulls after populated values', async () => {
    const value = factorySetup();
    const backup = allRecordTypes();
    try {
      await value.repository.replaceAll(backup, restoredPhotos, 90);
      await value.repository.replaceAll({ ...backup, records: backup.records.slice().reverse()
        .map((record) => ({ ...record, note: record.note === null ? '第二次' : null })) }, restoredPhotos, 100);
      expect(value.statistics).toEqual({ prepareCalls: 2, directRecordWrites: 0 });
      expect(value.statements.map((statement) => [statement.bindings.length, statement.finalizeCalls]))
        .toEqual([[7, 1], [7, 1]]);
      expect(value.sqlite.prepare("SELECT note FROM records WHERE id='historical-sleep'").get()).toEqual({ note: null });
      expect(value.sqlite.prepare("SELECT note FROM records WHERE id='restored-bottle-breast'").get())
        .toEqual({ note: '第二次' });
    } finally { value.sqlite.close(); }
  });

  test.each([
    ['prepare', 0, 0], ['second-execute', 2, 1], ['finalize', 7, 1],
    ['settings', 7, 1], ['counts', 7, 1], ['ids', 7, 1], ['integrity', 7, 1],
  ] as const)('failure at %s rolls back all data and preserves the error without retrying release', async (point, executions, releases) => {
    const primary = new Error(`Failure at ${point}`);
    const value = factorySetup({ failure: point, error: primary });
    try {
      await expect(value.repository.replaceAll(allRecordTypes(), restoredPhotos, 90)).rejects.toBe(primary);
      expect(value.snapshot()).toEqual(value.original);
      expect(value.statistics.prepareCalls).toBe(1);
      expect(value.statements.reduce((sum, statement) => sum + statement.bindings.length, 0)).toBe(executions);
      expect(value.statements.reduce((sum, statement) => sum + statement.finalizeCalls, 0)).toBe(releases);
      expect(value.events.at(-1)).toBe('rollback');
      expect(value.events).not.toContain('commit');
      if (point === 'prepare' || point === 'second-execute' || point === 'finalize') {
        expect(value.events).not.toContain('settings');
        expect(value.events).not.toContain('counts');
      }
    } finally { value.sqlite.close(); }
  });

  test('simultaneous execute and release failure keeps the existing SDK finally error precedence', async () => {
    const executeError = new Error('execute failed');
    const releaseError = new Error('release failed');
    const value = factorySetup({ failure: 'second-execute', error: executeError, finalizeError: releaseError });
    try {
      await expect(value.repository.replaceAll(allRecordTypes(), restoredPhotos, 90)).rejects.toBe(releaseError);
      expect(value.snapshot()).toEqual(value.original);
      expect(value.statements[0].bindings).toHaveLength(2);
      expect(value.statements[0].finalizeCalls).toBe(1);
      expect(value.events).not.toContain('settings');
      expect(value.events.at(-1)).toBe('rollback');
    } finally { value.sqlite.close(); }
  });

  test('awaits release before settings, validation and transaction commit', async () => {
    const entered = deferred();
    const release = deferred();
    const value = factorySetup({ beforeFinalize: async () => { entered.resolve(); await release.promise; } });
    const operation = value.repository.replaceAll(allRecordTypes(), restoredPhotos, 90);
    try {
      expect(await Promise.race([entered.promise.then(() => 'releasing'), operation.then(() => 'committed')]))
        .toBe('releasing');
      expect(value.events).not.toContain('settings');
      expect(value.events).not.toContain('counts');
      expect(value.events).not.toContain('commit');
      release.resolve();
      await operation;
      expect(value.events.slice(-7)).toEqual(['finalize-done', 'settings', 'counts', 'ids', 'sleeping', 'integrity', 'commit']);
      expect(value.statements[0].finalizeCalls).toBe(1);
    } finally {
      release.resolve();
      await operation.catch(() => undefined);
      value.sqlite.close();
    }
  });
});
