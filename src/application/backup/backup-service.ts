import type {
  BackupArchiveGateway,
  BackupBuildWorkspace,
  BackupFileStore,
  BackupOperationCoordinator,
  BackupPhotoGateway,
  BackupProgressObserver,
  BackupShareGateway,
  BackupSnapshotRepository,
} from '@/application/ports/backup';
import { emitBackupProgress } from '@/application/ports/backup';
import type { BackupValidationService } from '@/application/backup/backup-validation-service';
import {
  buildBackupManifest,
  serializeBackupJson,
  serializeBackupRecordsInBatches,
  serializeBackupRecordsWithByteLength,
} from '@/domain/backup/backup-manifest';
import { backupUtf8ByteLength, inspectBackupCreationCapacity } from '@/domain/backup/backup-capacity';
import type { BackupData, BackupIntegrityEntry } from '@/domain/backup/backup-types';
import { countBackupRecords, validateBackupData, validateBackupDataInBatches } from '@/domain/backup/backup-validation';

type Dependencies = {
  snapshotRepository: BackupSnapshotRepository;
  fileStore: BackupFileStore;
  archiveGateway: BackupArchiveGateway;
  photoGateway: BackupPhotoGateway;
  shareGateway: BackupShareGateway;
  validationService: Pick<BackupValidationService, 'prepare'>;
  coordinator: BackupOperationCoordinator;
  now(): number;
  createId(): string;
  appVersion: string;
  timezoneId(): string;
  timezoneOffsetMinutes(): number;
};

const DISK_SPACE_RESERVE_BYTES = 16 * 1024 * 1024;
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const SAFETY_BACKUP_SLICE_MS = 48;

function createSafetyBatchRunner() {
  let deadline = performance.now() + SAFETY_BACKUP_SLICE_MS;
  return async function runBatches<T>(batches: Generator<void, T>): Promise<T> {
    let step = batches.next();
    while (!step.done) {
      if (performance.now() >= deadline) {
        await yieldToUi();
        deadline = performance.now() + SAFETY_BACKUP_SLICE_MS;
      }
      step = batches.next();
    }
    return step.value;
  };
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

export function buildBackupFilename(nowMs: number) {
  const date = new Date(nowMs);
  return `baobao-today-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}.zip`;
}

export function createBackupService(dependencies: Dependencies) {
  let shareInFlight: Promise<{ filename: string; uri: string }> | null = null;

  async function createArchive(purpose: 'temporary' | 'safety', observer?: BackupProgressObserver) {
    const nowMs = dependencies.now();
    const backupId = dependencies.createId();
    const filename = buildBackupFilename(nowMs);
    let workspace: BackupBuildWorkspace | null = null;
    let keepArchive = false;
    try {
      emitBackupProgress(observer, { stage: 'snapshot' });
      await yieldToUi();
      const snapshot = await dependencies.snapshotRepository.getSnapshot();
      emitBackupProgress(observer, { stage: 'prepare-files' });
      const photoEntries: (BackupIntegrityEntry & { sourceUri: string })[] = [];
      const records = [] as BackupData['records'];
      for (const source of snapshot.records) {
        const { source_photo_path, ...record } = source;
        if (source_photo_path) {
          let photo;
          try { photo = await dependencies.photoGateway.inspectManaged(source_photo_path); }
          catch { throw new Error('有大便记录引用的照片已经不存在，无法创建完整备份。请先检查相关记录。'); }
          const path = `photos/${record.id}.jpg`;
          records.push({ ...record, photo_backup_entry: path, photo_sha256: photo.sha256 });
          photoEntries.push({ path, sourceUri: photo.uri, byteLength: photo.byteLength, sha256: photo.sha256 });
        } else {
          records.push({ ...record, photo_backup_entry: null, photo_sha256: null });
        }
        if (records.length % 512 === 0) await yieldToUi();
      }
      const input = { baby: snapshot.baby, records, settings: snapshot.settings };
      const runSafetyBatches = purpose === 'safety' ? createSafetyBatchRunner() : null;
      const data = runSafetyBatches
        ? await runSafetyBatches(validateBackupDataInBatches(input))
        : validateBackupData(input);
      const babyJson = serializeBackupJson(data.baby);
      const recordsJson = runSafetyBatches
        ? await runSafetyBatches(serializeBackupRecordsInBatches(data.records))
        : serializeBackupRecordsWithByteLength(data.records);
      const settingsJson = serializeBackupJson(data.settings);
      const jsonEntries = [
        { path: 'baby.json' as const, content: babyJson, byteLength: backupUtf8ByteLength(babyJson) },
        { path: 'records.json' as const, ...recordsJson },
        { path: 'settings.json' as const, content: settingsJson, byteLength: backupUtf8ByteLength(settingsJson) },
      ];
      const manifestInput = {
        backupId,
        createdAtMs: nowMs,
        appVersion: dependencies.appVersion,
        sourceSchemaVersion: snapshot.sourceSchemaVersion,
        timezoneId: dependencies.timezoneId(),
        timezoneOffsetMinutes: dependencies.timezoneOffsetMinutes(),
        babyId: data.baby.id,
        recordCounts: countBackupRecords(data.records),
      };
      // SHA-256 hex digests always have 64 characters, so this preview has the
      // same byte length as the real manifest without writing temporary JSON.
      const previewManifest = buildBackupManifest({ ...manifestInput, entries: [
        ...jsonEntries.map(({ path, byteLength }) => ({ path, byteLength, sha256: '0'.repeat(64) })),
        ...photoEntries.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
      ] });
      const capacity = inspectBackupCreationCapacity([
        { path: 'manifest.json', byteLength: backupUtf8ByteLength(serializeBackupJson(previewManifest)) },
        ...jsonEntries, ...photoEntries,
      ]);
      await dependencies.fileStore.ensureAvailableSpace(capacity.archiveBytes * 3 + DISK_SPACE_RESERVE_BYTES);
      workspace = await dependencies.fileStore.createBuildWorkspace(backupId, filename, purpose);
      const jsonFiles = [];
      for (const entry of jsonEntries) jsonFiles.push(await workspace.writeJson(entry.path, entry.content));
      const entries: BackupIntegrityEntry[] = [...jsonFiles, ...photoEntries]
        .map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 }));
      const manifest = buildBackupManifest({ ...manifestInput, entries });
      const manifestFile = await workspace.writeJson('manifest.json', serializeBackupJson(manifest));
      await dependencies.archiveGateway.createArchive(workspace.archiveUri, [
        { path: 'manifest.json', sourceUri: manifestFile.uri },
        ...jsonFiles.map((entry) => ({ path: entry.path, sourceUri: entry.uri })),
        ...photoEntries.map((entry) => ({ path: entry.path, sourceUri: entry.sourceUri })),
      ], ...(observer ? [observer] as const : []));
      const verification = await dependencies.validationService.prepare(workspace.archiveUri, `verify-${backupId}`,
        ...(observer ? [observer] as const : []));
      await verification.dispose();
      keepArchive = true;
      return { filename, uri: workspace.archiveUri, manifest };
    } finally {
      if (workspace) {
        await workspace.cleanup();
        if (!keepArchive) await dependencies.fileStore.deleteArchive(workspace.archiveUri);
      }
    }
  }

  function createAndShare(observer?: BackupProgressObserver) {
    if (shareInFlight) return shareInFlight;
    shareInFlight = dependencies.coordinator.runExclusive(async () => {
      await dependencies.fileStore.cleanupExpiredTemporary(dependencies.now());
      const created = await createArchive('temporary', observer);
      if (!(await dependencies.shareGateway.isAvailable())) throw new Error('当前设备无法打开系统分享面板');
      await dependencies.shareGateway.share(created.uri, created.filename);
      return { filename: created.filename, uri: created.uri };
    }).finally(() => { shareInFlight = null; });
    return shareInFlight;
  }

  return {
    createAndShare,
    // The export application service owns the shared operation coordinator.
    createExportArchive: (observer?: BackupProgressObserver) => createArchive('temporary', observer),
    createSafetyArchive: (observer?: BackupProgressObserver) => createArchive('safety', observer),
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
