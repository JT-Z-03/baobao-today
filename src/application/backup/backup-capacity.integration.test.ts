/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite; the app does not install Node typings.
import { DatabaseSync } from 'node:sqlite';
import type { BackupFileStore, BackupPhotoGateway, BackupSnapshot } from '@/application/ports/backup';
import { FflateBackupArchiveGateway, type ArchiveBinaryIo } from '@/data/backup/fflate-backup-archive-gateway';
import { MIGRATIONS } from '@/data/database/migrations';
import { SQLiteRestoreRepository, type RestoreDatabase } from '@/data/repositories/sqlite-restore-repository';
import type { BackupData } from '@/domain/backup/backup-types';
import { createBackupService } from './backup-service';
import { createBackupValidationService } from './backup-validation-service';
import { BackupRestoreCoordinator } from './backup-restore-coordinator';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const now = 1793070000000;

function syntheticSnapshot(count: number, note: string | null): BackupSnapshot {
  return {
    sourceSchemaVersion: 9,
    baby: { id: 'baby-1', name: '虚构宝宝', birth_date: '2026-10-01', created_at_ms: now, updated_at_ms: now },
    settings: { theme_mode: 'system', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null },
    records: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      client_request_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      create_payload_hash: 'a'.repeat(64), type: 'feeding',
      event_time_ms: now, record_date: '2026-10-27', sort_time_ms: now, created_at_ms: now, updated_at_ms: now,
      note, feeding_type: 'formula', milk_amount_ml: 60, breast_milk_amount_ml: null,
      left_duration_min: null, right_duration_min: null, poop_color: null, poop_texture: null, poop_amount: null,
      source_photo_path: null, pee_color: null, pee_amount: null,
      sleep_start_ms: null, sleep_end_ms: null, sleep_status: null, other_title: null,
    })),
  };
}

async function hashText(content: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function memoryHarness(snapshot: BackupSnapshot) {
  const files = new Map<string, Uint8Array>();
  const writtenPaths: string[] = [];
  const removePrefix = (prefix: string) => {
    for (const path of files.keys()) if (path.startsWith(prefix)) files.delete(path);
  };
  const io: ArchiveBinaryIo = {
    openReader: (uri) => {
      const bytes = files.get(uri);
      if (!bytes) throw new Error(`missing test file: ${uri}`);
      return {
        size: bytes.length, readAt: (offset, length) => bytes.slice(offset, offset + length), close: () => undefined,
        forEachChunk: (size, visit) => {
          if (!bytes.length) { visit(bytes, true); return; }
          for (let offset = 0; offset < bytes.length; offset += size) {
            visit(bytes.subarray(offset, offset + size), offset + size >= bytes.length);
          }
        },
      };
    },
    openWriter: (uri) => {
      writtenPaths.push(uri);
      const chunks: Uint8Array[] = [];
      return {
        write: (bytes) => chunks.push(bytes.slice()),
        close: () => {
          const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          files.set(uri, bytes);
        },
      };
    },
  };
  const fileStore: BackupFileStore = {
    ensureAvailableSpace: async () => undefined,
    createBuildWorkspace: async (id, filename) => ({
      id, filename, archiveUri: `archive/${filename}`,
      writeJson: async (path, content) => {
        const uri = `build/${id}/${path}`;
        const bytes = encoder.encode(content);
        files.set(uri, bytes); writtenPaths.push(uri);
        return { path, uri, byteLength: bytes.length, sha256: await hashText(content) };
      },
      cleanup: async () => removePrefix(`build/${id}/`),
    }),
    createRestoreWorkspace: async (id, source) => {
      const archiveUri = `restore/${id}/source.zip`;
      files.set(archiveUri, files.get(source)!.slice());
      return {
        id, archiveUri, targetUri: (path) => `restore/${id}/${path}`,
        readText: async (path) => decoder.decode(files.get(`restore/${id}/${path}`)),
        cleanup: async () => removePrefix(`restore/${id}/`),
      };
    },
    getSafetyArchiveUri: async () => null, promoteSafetyArchive: async () => undefined,
    deleteArchive: async (uri) => { files.delete(uri); },
    cleanupExpiredTemporary: async () => ({ deleted: 0, failed: 0 }), cleanupStaging: async () => undefined,
  };
  const unexpectedPhoto = async (): Promise<never> => { throw new Error('unexpected photo operation'); };
  const photoGateway: BackupPhotoGateway = {
    inspectManaged: unexpectedPhoto, validateStaged: unexpectedPhoto,
    restoreStaged: unexpectedPhoto, deleteManaged: unexpectedPhoto,
  };
  const archiveGateway = new FflateBackupArchiveGateway(io);
  const validationService = createBackupValidationService({
    fileStore, archiveGateway, photoGateway, hashGateway: { sha256Text: hashText },
  });
  const service = createBackupService({
    snapshotRepository: { getSnapshot: async () => snapshot }, fileStore, archiveGateway, photoGateway,
    validationService, coordinator: new BackupRestoreCoordinator(),
    shareGateway: { isAvailable: async () => true, share: async () => undefined },
    now: () => now, createId: () => 'capacity-test', appVersion: 'test',
    timezoneId: () => 'Asia/Shanghai', timezoneOffsetMinutes: () => -480,
  });
  return { service, validationService, archiveGateway, files, writtenPaths, photoGateway };
}

async function verifySqliteRestore(data: BackupData) {
  const sqlite = new DatabaseSync(':memory:');
  type Value = string | number | null;
  try {
    for (const migration of MIGRATIONS) {
      sqlite.exec(migration.sql); sqlite.exec(`PRAGMA user_version=${migration.version}`);
    }
    const query = {
      execAsync: async (sql: string) => sqlite.exec(sql),
      getFirstAsync: async <T,>(sql: string, ...params: Value[]) =>
        (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      getAllAsync: async <T,>(sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: Value[]) => sqlite.prepare(sql).run(...params),
    };
    const database: RestoreDatabase = {
      ...query,
      withExclusiveTransactionAsync: async (task) => {
        sqlite.exec('BEGIN IMMEDIATE');
        try { await task(query); sqlite.exec('COMMIT'); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    await new SQLiteRestoreRepository(database).replaceAll(data, new Map(), now);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: data.records.length });
    expect(sqlite.prepare('SELECT note,milk_amount_ml FROM records WHERE id=?').get(data.records[0].id))
      .toEqual({ note: data.records[0].note, milk_amount_ml: 60 });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
  } finally { sqlite.close(); }
}

test.each([
  [5992, null],
  [3560, '测'.repeat(200)],
] as const)('complete archive round-trip preserves the formerly rejected %i-record dataset', async (count, note) => {
  const snapshot = syntheticSnapshot(count, note);
  const { service, validationService } = memoryHarness(snapshot);
  const archive = await service.createExportArchive();
  const prepared = await validationService.prepare(archive.uri, 'roundtrip');
  try {
    expect(prepared.manifest.formatVersion).toBe(2);
    expect(prepared.data.records).toHaveLength(count);
    expect(prepared.data.records[0]).toMatchObject({ id: snapshot.records[0].id, note, milk_amount_ml: 60 });
    expect(prepared.data.records.at(-1)?.id).toBe(snapshot.records.at(-1)?.id);
    expect(prepared.manifest.entries.find((entry) => entry.path === 'records.json')!.byteLength).toBeLessThan(5 * 1024 * 1024);
    await verifySqliteRestore(prepared.data);
  } finally { await prepared.dispose(); }
});

test('supports a complete archive with records beyond the legacy 5 MiB budget', async () => {
  const { service, validationService } = memoryHarness(syntheticSnapshot(10_000, '测'.repeat(200)));
  const archive = await service.createExportArchive();
  const prepared = await validationService.prepare(archive.uri, 'large-roundtrip');
  try {
    expect(prepared.data.records).toHaveLength(10_000);
    expect(prepared.manifest.entries.find((entry) => entry.path === 'records.json')!.byteLength).toBeGreaterThan(5 * 1024 * 1024);
    await verifySqliteRestore(prepared.data);
  } finally { await prepared.dispose(); }
});

test.each([1, 2] as const)('restores the original indented format %i through the real archive gateway', async (formatVersion) => {
  const { service, validationService, archiveGateway, files } = memoryHarness(syntheticSnapshot(2, '历史备注'));
  const current = await service.createExportArchive();
  const prepared = await validationService.prepare(current.uri, 'current');
  try {
    const records = formatVersion === 1
      ? prepared.data.records.map(({ breast_milk_amount_ml: _unused, ...record }) => record)
      : prepared.data.records;
    const texts = [
      { path: 'baby.json', content: `${JSON.stringify(prepared.data.baby, null, 2)}\n` },
      { path: 'records.json', content: `${JSON.stringify(records, null, 2)}\n` },
      { path: 'settings.json', content: `${JSON.stringify(prepared.data.settings, null, 2)}\n` },
    ];
    const entries = [];
    for (const entry of texts) {
      const bytes = encoder.encode(entry.content);
      files.set(`legacy/${entry.path}`, bytes);
      entries.push({ path: entry.path, byteLength: bytes.length, sha256: await hashText(entry.content) });
    }
    files.set('legacy/manifest.json', encoder.encode(JSON.stringify({ ...prepared.manifest, formatVersion, entries }, null, 2)));
    await archiveGateway.createArchive('legacy.zip', ['manifest.json', ...texts.map((entry) => entry.path)]
      .map((path) => ({ path, sourceUri: `legacy/${path}` })));
    const restored = await validationService.prepare('legacy.zip', 'legacy-roundtrip');
    try {
      expect(restored.manifest.formatVersion).toBe(formatVersion);
      expect(restored.data).toEqual(prepared.data);
      await verifySqliteRestore(restored.data);
    } finally { await restored.dispose(); }
  } finally { await prepared.dispose(); }
});

test('rejects record capacity before writing any JSON or ZIP and preserves the source snapshot', async () => {
  const snapshot = syntheticSnapshot(15_000, '测'.repeat(200));
  const { service, writtenPaths } = memoryHarness(snapshot);
  await expect(service.createExportArchive()).rejects.toThrow(/记录.*16 MiB/);
  expect(writtenPaths).toEqual([]);
  expect(snapshot.records).toHaveLength(15_000);
  expect(snapshot.records[0].note).toBe('测'.repeat(200));
});

test('rejects the total photo capacity before writing any JSON or ZIP', async () => {
  const snapshot = syntheticSnapshot(26, null);
  snapshot.records = snapshot.records.map((record) => ({
    ...record, type: 'poop', feeding_type: null, milk_amount_ml: null,
    source_photo_path: `poop-photos/${record.id}.jpg`,
  }));
  const { service, writtenPaths, photoGateway } = memoryHarness(snapshot);
  photoGateway.inspectManaged = async (path) => ({
    relativePath: path, uri: path, byteLength: 20 * 1024 * 1024, sha256: 'b'.repeat(64),
  });
  await expect(service.createExportArchive()).rejects.toThrow();
  expect(writtenPaths).toEqual([]);
});
