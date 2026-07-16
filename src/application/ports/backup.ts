import type {
  BackupBaby,
  BackupData,
  BackupRecord,
  BackupSettings,
} from '@/domain/backup/backup-types';

export type BackupSourceRecord = Omit<BackupRecord, 'photo_backup_entry' | 'photo_sha256'> & {
  source_photo_path: string | null;
};

export interface BackupSnapshot {
  sourceSchemaVersion: number;
  baby: BackupBaby;
  records: BackupSourceRecord[];
  settings: BackupSettings;
}

export interface BackupSnapshotRepository {
  getSnapshot(): Promise<BackupSnapshot>;
}

export interface RestoreRepository {
  hasCurrentData(): Promise<boolean>;
  listReferencedPhotoPaths(): Promise<string[]>;
  replaceAll(
    data: BackupData,
    photoPaths: ReadonlyMap<string, string>,
    restoredAtMs: number,
  ): Promise<void>;
}

export interface BackupIntegrityFile {
  path: string;
  uri: string;
  byteLength: number;
  sha256: string;
}

export interface BackupBuildWorkspace {
  id: string;
  filename: string;
  archiveUri: string;
  writeJson(path: 'manifest.json' | 'baby.json' | 'records.json' | 'settings.json', content: string): Promise<BackupIntegrityFile>;
  cleanup(): Promise<void>;
}

export interface BackupRestoreWorkspace {
  id: string;
  archiveUri: string;
  targetUri(path: string): string;
  readText(path: 'manifest.json' | 'baby.json' | 'records.json' | 'settings.json'): Promise<string>;
  cleanup(): Promise<void>;
}

export interface BackupFileStore {
  ensureAvailableSpace(requiredBytes: number): Promise<void>;
  createBuildWorkspace(id: string, filename: string, purpose: 'temporary' | 'safety'): Promise<BackupBuildWorkspace>;
  createRestoreWorkspace(id: string, sourceArchiveUri: string): Promise<BackupRestoreWorkspace>;
  promoteSafetyArchive(pendingUri: string): Promise<void>;
  getSafetyArchiveUri(): Promise<string | null>;
  deleteArchive(uri: string): Promise<void>;
  cleanupExpiredTemporary(nowMs: number, currentUri?: string): Promise<{ deleted: number; failed: number }>;
  cleanupStaging(): Promise<void>;
}

export interface BackupArchiveEntry {
  path: string;
  sourceUri: string;
}

export interface BackupArchiveInspectionEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface BackupArchiveInspection {
  archiveSize: number;
  entries: BackupArchiveInspectionEntry[];
  totalUncompressedSize: number;
}

export interface BackupArchiveGateway {
  createArchive(outputUri: string, entries: readonly BackupArchiveEntry[]): Promise<void>;
  inspect(archiveUri: string): Promise<BackupArchiveInspection>;
  extract(archiveUri: string, targets: ReadonlyMap<string, string>): Promise<BackupArchiveInspection>;
}

export interface BackupPhotoSource {
  relativePath: string;
  uri: string;
  byteLength: number;
  sha256: string;
}

export interface BackupPhotoGateway {
  inspectManaged(relativePath: string): Promise<BackupPhotoSource>;
  validateStaged(uri: string, byteLength: number, sha256: string): Promise<void>;
  restoreStaged(uri: string, restoreSessionId: string, recordId: string, byteLength: number, sha256: string): Promise<string>;
  deleteManaged(relativePath: string): Promise<void>;
}

export interface BackupDocumentPickerGateway {
  pickBackup(): Promise<{ canceled: true } | { canceled: false; uri: string; name: string; size: number | null }>;
}

export interface BackupShareGateway {
  isAvailable(): Promise<boolean>;
  share(uri: string, filename: string): Promise<void>;
}

export interface BackupHashGateway {
  sha256Text(content: string): Promise<string>;
}

export interface BackupOperationCoordinator {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  readonly busy: boolean;
}
