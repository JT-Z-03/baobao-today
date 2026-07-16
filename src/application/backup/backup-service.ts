import type {
  BackupArchiveGateway,
  BackupFileStore,
  BackupOperationCoordinator,
  BackupPhotoGateway,
  BackupShareGateway,
  BackupSnapshotRepository,
} from '@/application/ports/backup';
import type { BackupValidationService } from '@/application/backup/backup-validation-service';
import {
  buildBackupManifest,
  serializeBackupJson,
} from '@/domain/backup/backup-manifest';
import type { BackupData, BackupIntegrityEntry } from '@/domain/backup/backup-types';
import { countBackupRecords, validateBackupData } from '@/domain/backup/backup-validation';

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

  async function createArchive(purpose: 'temporary' | 'safety') {
    const nowMs = dependencies.now();
    const backupId = dependencies.createId();
    const filename = buildBackupFilename(nowMs);
    const workspace = await dependencies.fileStore.createBuildWorkspace(backupId, filename, purpose);
    let keepArchive = false;
    try {
      const snapshot = await dependencies.snapshotRepository.getSnapshot();
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
      }
      const data = validateBackupData({ baby: snapshot.baby, records, settings: snapshot.settings });
      const babyJson = serializeBackupJson(data.baby);
      const recordsJson = serializeBackupJson(data.records);
      const settingsJson = serializeBackupJson(data.settings);
      const jsonBytes = new TextEncoder().encode(babyJson).length
        + new TextEncoder().encode(recordsJson).length
        + new TextEncoder().encode(settingsJson).length;
      const sourceBytes = jsonBytes + photoEntries.reduce((total, entry) => total + entry.byteLength, 0);
      await dependencies.fileStore.ensureAvailableSpace(sourceBytes * 3 + DISK_SPACE_RESERVE_BYTES);
      const babyFile = await workspace.writeJson('baby.json', babyJson);
      const recordsFile = await workspace.writeJson('records.json', recordsJson);
      const settingsFile = await workspace.writeJson('settings.json', settingsJson);
      const entries: BackupIntegrityEntry[] = [babyFile, recordsFile, settingsFile, ...photoEntries]
        .map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 }));
      const manifest = buildBackupManifest({
        backupId,
        createdAtMs: nowMs,
        appVersion: dependencies.appVersion,
        sourceSchemaVersion: snapshot.sourceSchemaVersion,
        timezoneId: dependencies.timezoneId(),
        timezoneOffsetMinutes: dependencies.timezoneOffsetMinutes(),
        babyId: data.baby.id,
        recordCounts: countBackupRecords(data.records),
        entries,
      });
      const manifestFile = await workspace.writeJson('manifest.json', serializeBackupJson(manifest));
      await dependencies.archiveGateway.createArchive(workspace.archiveUri, [
        { path: 'manifest.json', sourceUri: manifestFile.uri },
        { path: 'baby.json', sourceUri: babyFile.uri },
        { path: 'records.json', sourceUri: recordsFile.uri },
        { path: 'settings.json', sourceUri: settingsFile.uri },
        ...photoEntries.map((entry) => ({ path: entry.path, sourceUri: entry.sourceUri })),
      ]);
      const verification = await dependencies.validationService.prepare(workspace.archiveUri, `verify-${backupId}`);
      await verification.dispose();
      keepArchive = true;
      return { filename, uri: workspace.archiveUri, manifest };
    } finally {
      await workspace.cleanup();
      if (!keepArchive) await dependencies.fileStore.deleteArchive(workspace.archiveUri);
    }
  }

  function createAndShare() {
    if (shareInFlight) return shareInFlight;
    shareInFlight = dependencies.coordinator.runExclusive(async () => {
      await dependencies.fileStore.cleanupExpiredTemporary(dependencies.now());
      const created = await createArchive('temporary');
      if (!(await dependencies.shareGateway.isAvailable())) throw new Error('当前设备无法打开系统分享面板');
      await dependencies.shareGateway.share(created.uri, created.filename);
      return { filename: created.filename, uri: created.uri };
    }).finally(() => { shareInFlight = null; });
    return shareInFlight;
  }

  return {
    createAndShare,
    createSafetyArchive: () => createArchive('safety'),
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
