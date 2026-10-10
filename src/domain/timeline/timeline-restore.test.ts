/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite without adding Node typings to the app.
import { DatabaseSync } from 'node:sqlite';
import { strToU8, zipSync } from 'fflate';

import { createBackupValidationService } from '@/application/backup/backup-validation-service';
import { createBackupService } from '@/application/backup/backup-service';
import { BackupRestoreCoordinator } from '@/application/backup/backup-restore-coordinator';
import type { BackupFileStore, BackupPhotoGateway } from '@/application/ports/backup';
import { createSleepService } from '@/application/sleep/sleep-service';
import { FflateBackupArchiveGateway, type ArchiveBinaryIo } from '@/data/backup/fflate-backup-archive-gateway';
import { MIGRATIONS } from '@/data/database/migrations';
import { SQLiteRestoreRepository, type RestoreQueryDatabase } from '@/data/repositories/sqlite-restore-repository';
import { SQLiteBackupSnapshotRepository } from '@/data/repositories/sqlite-backup-snapshot-repository';
import { SQLiteSleepRepository } from '@/data/repositories/sqlite-sleep-repository';
import { buildBackupManifest } from '@/domain/backup/backup-manifest';
import { countBackupRecords, validateBackupData } from '@/domain/backup/backup-validation';

function sha256Text(content: string): Promise<string> {
  const { createHash } = jest.requireActual('node:crypto');
  return Promise.resolve(createHash('sha256').update(content).digest('hex'));
}

class MemoryArchiveIo implements ArchiveBinaryIo {
  readonly files = new Map<string, Uint8Array>();
  openReader(uri: string) {
    const bytes = this.files.get(uri);
    if (!bytes) throw new Error('Missing isolated archive file');
    return {
      size: bytes.length,
      readAt: (offset: number, length: number) => bytes.slice(offset, offset + length),
      forEachChunk: (chunkSize: number, visit: (chunk: Uint8Array, final: boolean) => void) => {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          visit(bytes.slice(offset, offset + chunkSize), offset + chunkSize >= bytes.length);
        }
      },
      close: () => undefined,
    };
  }
  openWriter(uri: string) {
    const chunks: Uint8Array[] = [];
    return {
      write: (bytes: Uint8Array) => { chunks.push(bytes.slice()); },
      close: () => {
        const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
        this.files.set(uri, output);
      },
    };
  }
}

test.each([
  { recordDate: '2026-07-10', startHour: 1, timezoneId: 'Pacific/Honolulu', timezoneOffsetMinutes: 600 },
  { recordDate: '2026-07-12', startHour: 23, timezoneId: 'Pacific/Kiritimati', timezoneOffsetMinutes: -840 },
])('preserves $recordDate through validated ZIP, SQLite restore and sleep timeline', async (source) => {
  const startMs = new Date(2026, 6, 11, source.startHour, 0).getTime();
  const endMs = startMs + 20 * 60_000;
  const babyName = '宝'.repeat(19) + '🙂';
  const sleepNote = '记'.repeat(199) + '🙂';
  const base = {
    client_request_id: 'completed-request', create_payload_hash: 'a'.repeat(64),
    type: 'sleep', event_time_ms: startMs, record_date: source.recordDate, sort_time_ms: startMs,
    created_at_ms: startMs, updated_at_ms: endMs, note: sleepNote, feeding_type: null, milk_amount_ml: null,
    breast_milk_amount_ml: null, left_duration_min: null, right_duration_min: null,
    poop_color: null, poop_texture: null, poop_amount: null, photo_backup_entry: null,
    photo_sha256: null, pee_color: null, pee_amount: null, sleep_start_ms: startMs, other_title: null,
  };
  const data = validateBackupData({
    baby: { id: 'fictional-baby', name: babyName, birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 1 },
    records: [
      { ...base, id: 'completed', sleep_end_ms: endMs, sleep_status: 'completed' },
      { ...base, id: 'active', client_request_id: 'active-request', sleep_end_ms: null, sleep_status: 'sleeping' },
    ],
    settings: { theme_mode: 'system', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null },
  });
  const jsonFiles = [
    ['baby.json', JSON.stringify(data.baby)],
    ['records.json', JSON.stringify(data.records)],
    ['settings.json', JSON.stringify(data.settings)],
  ] as const;
  const entries = await Promise.all(jsonFiles.map(async ([path, content]) => ({
    path, byteLength: strToU8(content).length, sha256: await sha256Text(content),
  })));
  const manifest = buildBackupManifest({
    backupId: 'timezone-regression', createdAtMs: endMs, appVersion: '1.2.0', sourceSchemaVersion: 9,
    timezoneId: source.timezoneId, timezoneOffsetMinutes: source.timezoneOffsetMinutes,
    babyId: data.baby.id, recordCounts: countBackupRecords(data.records), entries,
  });
  const io = new MemoryArchiveIo();
  io.files.set('backup.zip', zipSync(Object.fromEntries([
    ['manifest.json', strToU8(JSON.stringify(manifest))],
    ...jsonFiles.map(([path, content]) => [path, strToU8(content)]),
  ])));
  const fileStore: BackupFileStore = {
    ensureAvailableSpace: async () => undefined,
    createBuildWorkspace: async (id, filename) => ({
      id, filename, archiveUri: 'generated.zip',
      writeJson: async (path, content) => {
        const uri = `build/${path}`;
        const bytes = strToU8(content);
        io.files.set(uri, bytes);
        return { path, uri, byteLength: bytes.length, sha256: await sha256Text(content) };
      },
      cleanup: async () => {
        for (const path of ['manifest.json', 'baby.json', 'records.json', 'settings.json']) io.files.delete(`build/${path}`);
      },
    }),
    createRestoreWorkspace: async (id, archiveUri) => ({
      id, archiveUri, targetUri: (path) => `staged/${path}`,
      readText: async (path) => new TextDecoder().decode(io.files.get(`staged/${path}`)),
      cleanup: async () => {
        for (const path of ['manifest.json', 'baby.json', 'records.json', 'settings.json']) io.files.delete(`staged/${path}`);
      },
    }),
    promoteSafetyArchive: async () => undefined,
    getSafetyArchiveUri: async () => null,
    deleteArchive: async () => undefined,
    cleanupExpiredTemporary: async () => ({ deleted: 0, failed: 0 }),
    cleanupStaging: async () => undefined,
  };
  const unusedPhoto = async (): Promise<never> => { throw new Error('No photos in isolated fixture'); };
  const photoGateway: BackupPhotoGateway = {
    inspectManaged: unusedPhoto, validateStaged: unusedPhoto, restoreStaged: unusedPhoto, deleteManaged: unusedPhoto,
  };
  const archiveGateway = new FflateBackupArchiveGateway(io);
  const validationService = createBackupValidationService({
    fileStore, archiveGateway, photoGateway, hashGateway: { sha256Text },
  });
  const prepared = await validationService.prepare('backup.zip', 'restore-regression');
  expect(prepared.data.baby.name).toBe(babyName);
  expect(prepared.data.records.map((record) => record.note)).toEqual([sleepNote, sleepNote]);

  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const migration of MIGRATIONS) { sqlite.exec(migration.sql); sqlite.exec(`PRAGMA user_version=${migration.version}`); }
    type Value = string | number | null;
    const query = {
      execAsync: async (sql: string) => { sqlite.exec(sql); },
      getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
        (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
    };
    const database = {
      ...query,
      withExclusiveTransactionAsync: async (task: (transaction: RestoreQueryDatabase) => Promise<void>) => {
        sqlite.exec('BEGIN IMMEDIATE');
        try { await task(query); sqlite.exec('COMMIT'); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    await new SQLiteRestoreRepository(database).replaceAll(prepared.data, new Map(), endMs);
    const service = createSleepService(new SQLiteSleepRepository(database, sha256Text), {
      now: () => endMs, createId: () => 'unused', createClientRequestId: () => 'unused',
    });
    expect((await service.getTimeline(source.recordDate)).map((event) => [event.recordId, event.kind]))
      .toEqual([['completed', 'sleep-start'], ['active', 'sleep-start']]);
    expect((await service.getTimeline('2026-07-11')).map((event) => [event.recordId, event.kind]))
      .toEqual([['completed', 'sleep-end']]);
    expect(await service.getById('active')).toMatchObject({ recordDate: source.recordDate, startMs, status: 'sleeping', note: sleepNote });
    expect(await service.getById('completed')).toMatchObject({ note: sleepNote });
    expect(sqlite.prepare('SELECT name FROM baby').get()).toEqual({ name: babyName });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
    const exported = await createBackupService({
      snapshotRepository: new SQLiteBackupSnapshotRepository(database), fileStore, archiveGateway,
      photoGateway, validationService, coordinator: new BackupRestoreCoordinator(),
      shareGateway: { isAvailable: async () => false, share: async () => undefined },
      now: () => endMs, createId: () => 'export-regression', appVersion: '1.2.0',
      timezoneId: () => 'Asia/Shanghai', timezoneOffsetMinutes: () => -480,
    }).createExportArchive();
    const roundtrip = await validationService.prepare(exported.uri, 'roundtrip-regression');
    try {
      expect(roundtrip.data.baby.name).toBe(babyName);
      expect(roundtrip.data.records.map((record) => record.note)).toEqual([sleepNote, sleepNote]);
      expect(roundtrip.data.records.map((record) => record.record_date)).toEqual([source.recordDate, source.recordDate]);
    } finally { await roundtrip.dispose(); }
  } finally {
    sqlite.close();
    await prepared.dispose();
  }
});
