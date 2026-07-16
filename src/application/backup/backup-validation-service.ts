import type {
  BackupArchiveGateway,
  BackupFileStore,
  BackupHashGateway,
  BackupPhotoGateway,
  BackupRestoreWorkspace,
} from '@/application/ports/backup';
import { parseBackupManifest } from '@/domain/backup/backup-manifest';
import type { BackupData, BackupManifest } from '@/domain/backup/backup-types';
import { countBackupRecords, validateBackupData } from '@/domain/backup/backup-validation';

type Dependencies = {
  fileStore: BackupFileStore;
  archiveGateway: BackupArchiveGateway;
  photoGateway: BackupPhotoGateway;
  hashGateway: BackupHashGateway;
};

const DISK_SPACE_RESERVE_BYTES = 16 * 1024 * 1024;

export interface RestoreSummary {
  backupCreatedAtMs: number;
  appVersion: string;
  babyName: string;
  babyBirthDate: string;
  feedingCount: number;
  poopCount: number;
  peeCount: number;
  sleepCount: number;
  otherCount: number;
  photoCount: number;
  hasActiveSleep: boolean;
  themeMode: BackupData['settings']['theme_mode'];
  reminderEnabled: boolean;
  reminderIntervalMinutes: number | null;
  archiveBytes: number;
}

export interface PreparedBackup {
  workspace: BackupRestoreWorkspace;
  manifest: BackupManifest;
  data: BackupData;
  photoUris: ReadonlyMap<string, string>;
  summary: RestoreSummary;
  dispose(): Promise<void>;
}

function parseJson(content: string, label: string) {
  try { return JSON.parse(content) as unknown; }
  catch { throw new Error(`${label}不是有效的JSON`); }
}

function sameCounts(actual: ReturnType<typeof countBackupRecords>, expected: BackupManifest['recordCounts']) {
  return (Object.keys(expected) as (keyof typeof expected)[]).every((key) => actual[key] === expected[key]);
}

export function createBackupValidationService(dependencies: Dependencies) {
  async function prepare(sourceArchiveUri: string, restoreSessionId: string): Promise<PreparedBackup> {
    const workspace = await dependencies.fileStore.createRestoreWorkspace(restoreSessionId, sourceArchiveUri);
    try {
      const inspection = await dependencies.archiveGateway.inspect(workspace.archiveUri);
      await dependencies.fileStore.ensureAvailableSpace(
        inspection.archiveSize + inspection.totalUncompressedSize * 2 + DISK_SPACE_RESERVE_BYTES,
      );
      const paths = inspection.entries.map((entry) => entry.path);
      const targets = new Map(paths.map((path) => [path, workspace.targetUri(path)]));
      await dependencies.archiveGateway.extract(workspace.archiveUri, targets);
      if (!paths.includes('manifest.json')) throw new Error('备份缺少manifest.json');

      const manifest = parseBackupManifest(parseJson(await workspace.readText('manifest.json'), 'manifest.json'));
      const expectedPaths = new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)]);
      if (expectedPaths.size !== paths.length || paths.some((path) => !expectedPaths.has(path))) {
        throw new Error('备份清单与实际归档条目不一致');
      }
      const inspectedByPath = new Map(inspection.entries.map((entry) => [entry.path, entry]));
      for (const entry of manifest.entries) {
        if (inspectedByPath.get(entry.path)?.uncompressedSize !== entry.byteLength) {
          throw new Error('备份条目字节数与清单不一致');
        }
      }

      const babyText = await workspace.readText('baby.json');
      const recordsText = await workspace.readText('records.json');
      const settingsText = await workspace.readText('settings.json');
      const textByPath = new Map([
        ['baby.json', babyText], ['records.json', recordsText], ['settings.json', settingsText],
      ]);
      const manifestByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
      for (const [path, content] of textByPath) {
        const entry = manifestByPath.get(path);
        const byteLength = new TextEncoder().encode(content).length;
        const digest = await dependencies.hashGateway.sha256Text(content);
        if (!entry || entry.byteLength !== byteLength || entry.sha256 !== digest) {
          throw new Error(`${path}完整性校验失败`);
        }
      }

      const data = validateBackupData({
        baby: parseJson(babyText, 'baby.json'),
        records: parseJson(recordsText, 'records.json'),
        settings: parseJson(settingsText, 'settings.json'),
      });
      const counts = countBackupRecords(data.records);
      if (manifest.babyId !== data.baby.id || !sameCounts(counts, manifest.recordCounts)
        || manifest.totalRecordCount !== data.records.length) {
        throw new Error('备份清单与业务数据统计不一致');
      }

      const photoUris = new Map<string, string>();
      const referencedPhotos = data.records.filter((record) => record.photo_backup_entry !== null);
      if (referencedPhotos.length !== manifest.photoCount) throw new Error('备份照片引用数量不一致');
      for (const record of referencedPhotos) {
        const path = record.photo_backup_entry!;
        const entry = manifestByPath.get(path);
        if (!entry || entry.sha256 !== record.photo_sha256 || photoUris.has(path)) {
          throw new Error('备份照片引用与清单不一致');
        }
        const uri = workspace.targetUri(path);
        await dependencies.photoGateway.validateStaged(uri, entry.byteLength, entry.sha256);
        photoUris.set(path, uri);
      }
      const manifestPhotoPaths = manifest.entries.filter((entry) => entry.path.startsWith('photos/'));
      if (manifestPhotoPaths.some((entry) => !photoUris.has(entry.path))) throw new Error('备份包含未被记录引用的照片');

      const summary: RestoreSummary = {
        backupCreatedAtMs: manifest.createdAtMs,
        appVersion: manifest.appVersion,
        babyName: data.baby.name,
        babyBirthDate: data.baby.birth_date,
        feedingCount: counts.feeding,
        poopCount: counts.poop,
        peeCount: counts.pee,
        sleepCount: counts.sleep,
        otherCount: counts.other,
        photoCount: manifest.photoCount,
        hasActiveSleep: data.records.some((record) => record.sleep_status === 'sleeping'),
        themeMode: data.settings.theme_mode,
        reminderEnabled: data.settings.feeding_reminder_enabled,
        reminderIntervalMinutes: data.settings.feeding_reminder_interval_minutes,
        archiveBytes: inspection.archiveSize,
      };
      return { workspace, manifest, data, photoUris, summary, dispose: () => workspace.cleanup() };
    } catch (error) {
      await workspace.cleanup();
      throw error;
    }
  }

  return { prepare };
}

export type BackupValidationService = ReturnType<typeof createBackupValidationService>;
