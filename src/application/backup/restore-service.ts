import type { BackupService } from '@/application/backup/backup-service';
import type {
  BackupValidationService,
  PreparedBackup,
} from '@/application/backup/backup-validation-service';
import type {
  BackupDocumentPickerGateway,
  BackupFileStore,
  BackupOperationCoordinator,
  BackupPhotoGateway,
  RestoreRepository,
} from '@/application/ports/backup';

type RestoreWarning = 'old-photo-cleanup' | 'reminder-sync' | 'app-refresh';

type Dependencies = {
  validationService: Pick<BackupValidationService, 'prepare'>;
  fileStore: Pick<BackupFileStore, 'getSafetyArchiveUri' | 'promoteSafetyArchive' | 'deleteArchive'>;
  restoreRepository: RestoreRepository;
  backupService: Pick<BackupService, 'createSafetyArchive'>;
  photoGateway: BackupPhotoGateway;
  documentPicker: BackupDocumentPickerGateway;
  coordinator: BackupOperationCoordinator;
  reminderSync(): Promise<unknown>;
  refreshAppState(): Promise<void>;
  now(): number;
  createId(): string;
};

export class RestoreStateError extends Error {}

function isReminderSyncError(value: unknown): value is { kind: 'sync-error' } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'sync-error';
}

export function createRestoreService(dependencies: Dependencies) {
  let prepared: PreparedBackup | null = null;

  async function replacePrepared(next: PreparedBackup | null) {
    if (prepared && prepared !== next) await prepared.dispose();
    prepared = next;
    return next;
  }

  async function pickAndPrepare() {
    const result = await dependencies.documentPicker.pickBackup();
    if (result.canceled) return null;
    const next = await dependencies.validationService.prepare(result.uri, `external-${dependencies.createId()}`);
    return replacePrepared(next);
  }

  async function prepareUndo() {
    const safetyUri = await dependencies.fileStore.getSafetyArchiveUri();
    if (!safetyUri) throw new RestoreStateError('没有可用于撤销的恢复前安全备份');
    const next = await dependencies.validationService.prepare(safetyUri, `undo-${dependencies.createId()}`);
    return replacePrepared(next);
  }

  async function confirmPrepared() {
    if (!prepared) throw new RestoreStateError('请先选择并校验完整备份');
    const selected = prepared;
    return dependencies.coordinator.runExclusive(async () => {
      const operationId = dependencies.createId();
      let rechecked: PreparedBackup | null = null;
      const newPhotoPaths: string[] = [];
      let committed = false;
      try {
        rechecked = await dependencies.validationService.prepare(
          selected.workspace.archiveUri,
          `recheck-${operationId}`,
        );
        if (await dependencies.restoreRepository.hasCurrentData()) {
          let safety;
          try { safety = await dependencies.backupService.createSafetyArchive(); }
          catch { throw new Error('无法创建恢复前安全备份，本次恢复已取消，当前数据没有改变。'); }
          try { await dependencies.fileStore.promoteSafetyArchive(safety.uri); }
          catch (error) {
            try { await dependencies.fileStore.deleteArchive(safety.uri); } catch { /* best effort */ }
            throw error;
          }
        }

        const oldPhotoPaths = await dependencies.restoreRepository.listReferencedPhotoPaths();
        const restoredPhotoMap = new Map<string, string>();
        const manifestEntries = new Map(rechecked.manifest.entries.map((entry) => [entry.path, entry]));
        for (const record of rechecked.data.records) {
          if (!record.photo_backup_entry) continue;
          const archivePath = record.photo_backup_entry;
          const entry = manifestEntries.get(archivePath);
          const stagedUri = rechecked.photoUris.get(archivePath);
          if (!entry || !stagedUri || entry.sha256 !== record.photo_sha256) throw new Error('恢复照片引用不完整');
          const relativePath = await dependencies.photoGateway.restoreStaged(
            stagedUri,
            operationId,
            record.id,
            entry.byteLength,
            entry.sha256,
          );
          restoredPhotoMap.set(archivePath, relativePath);
          newPhotoPaths.push(relativePath);
        }

        await dependencies.restoreRepository.replaceAll(rechecked.data, restoredPhotoMap, dependencies.now());
        committed = true;
        const warnings: RestoreWarning[] = [];
        for (const oldPath of oldPhotoPaths) {
          if (newPhotoPaths.includes(oldPath)) continue;
          try { await dependencies.photoGateway.deleteManaged(oldPath); }
          catch { if (!warnings.includes('old-photo-cleanup')) warnings.push('old-photo-cleanup'); }
        }
        try {
          if (isReminderSyncError(await dependencies.reminderSync())) warnings.push('reminder-sync');
        }
        catch { warnings.push('reminder-sync'); }
        try { await dependencies.refreshAppState(); }
        catch { warnings.push('app-refresh'); }
        return { committed: true as const, warnings };
      } catch (error) {
        if (!committed) {
          for (const newPath of newPhotoPaths) {
            try { await dependencies.photoGateway.deleteManaged(newPath); } catch { /* orphan cleanup fallback */ }
          }
        }
        throw error;
      } finally {
        if (rechecked) await rechecked.dispose();
        if (prepared === selected) {
          await selected.dispose();
          prepared = null;
        }
      }
    });
  }

  async function hasUndo() {
    return (await dependencies.fileStore.getSafetyArchiveUri()) !== null;
  }

  async function cancelPrepared() {
    await replacePrepared(null);
  }

  return { pickAndPrepare, prepareUndo, confirmPrepared, hasUndo, cancelPrepared };
}

export type RestoreService = ReturnType<typeof createRestoreService>;
