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
  BackupProgressObserver,
} from '@/application/ports/backup';
import { emitBackupProgress } from '@/application/ports/backup';

export type RestoreWarning = 'old-photo-cleanup' | 'reminder-sync' | 'app-refresh' | 'draft-state' | 'restore-workspace-cleanup';
export type RestoreResult = { warnings: RestoreWarning[]; busy: boolean };
type RestoreAction = 'restore' | 'undo';
type PreparedRestore = { backup: PreparedBackup; action: RestoreAction };
type RecoveryTask = { warning: RestoreWarning; run(): Promise<unknown> };
type RecoveryState = {
  result: RestoreResult | null;
  completion: RestoreAction | null;
  tasks: RecoveryTask[];
  listeners: Set<() => void>;
  inFlight: boolean;
};
// Provider refresh recreates services and navigation. Keep the receipt scoped to
// its stable coordinator, without retaining it across app processes or datasets.
const recoveryStates = new WeakMap<BackupOperationCoordinator, RecoveryState>();

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
  workflow?: { begin(id: string): Promise<void>; end(id: string, committed: boolean): Promise<void> };
};

export class RestoreStateError extends Error {}

function isReminderSyncError(value: unknown): value is { kind: 'sync-error' } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'sync-error';
}

export function createRestoreService(dependencies: Dependencies) {
  let prepared: PreparedRestore | null = null;
  let recovery = recoveryStates.get(dependencies.coordinator);
  if (!recovery) {
    recovery = { result: null, completion: null, tasks: [], listeners: new Set(), inFlight: false };
    recoveryStates.set(dependencies.coordinator, recovery);
  }
  const state = recovery;
  const publish = () => state.listeners.forEach((listener) => {
    try { listener(); } catch { /* UI feedback must not turn a committed restore into failure. */ }
  });
  const pendingWarnings = () => [...new Set(state.tasks.map((task) => task.warning))];
  const assertAcknowledged = () => {
    if (state.inFlight) throw new RestoreStateError('正在处理恢复，请稍候');
    if (state.result) throw new RestoreStateError('请先处理或确认上次恢复结果');
  };

  async function replacePrepared(next: PreparedRestore | null) {
    if (prepared && prepared.backup !== next?.backup) await prepared.backup.dispose();
    prepared = next;
    return next?.backup ?? null;
  }

  async function pickAndPrepare(observer?: BackupProgressObserver) {
    assertAcknowledged();
    const result = await dependencies.documentPicker.pickBackup();
    if (result.canceled) return null;
    const next = await dependencies.validationService.prepare(result.uri, `external-${dependencies.createId()}`, ...(observer ? [observer] : []));
    return replacePrepared({ backup: next, action: 'restore' });
  }

  async function prepareUndo(observer?: BackupProgressObserver) {
    assertAcknowledged();
    const safetyUri = await dependencies.fileStore.getSafetyArchiveUri();
    if (!safetyUri) throw new RestoreStateError('没有可用于撤销的恢复前安全备份');
    const next = await dependencies.validationService.prepare(safetyUri, `undo-${dependencies.createId()}`, ...(observer ? [observer] : []));
    return replacePrepared({ backup: next, action: 'undo' });
  }

  async function confirmPrepared(observer?: BackupProgressObserver) {
    assertAcknowledged();
    if (!prepared) throw new RestoreStateError('请先选择并校验完整备份');
    const selected = prepared;
    const warnings: RestoreWarning[] = [];
    const tasks: RecoveryTask[] = [];
    const attempt = async (warning: RestoreWarning, run: () => Promise<unknown>) => {
      try { await run(); }
      catch { tasks.push({ warning, run }); if (!warnings.includes(warning)) warnings.push(warning); }
    };
    state.inFlight = true;
    takeCompletion();
    try {
    const result = await dependencies.coordinator.runExclusive(async () => {
      if (prepared !== selected) throw new RestoreStateError('该备份已处理，请重新选择');
      const operationId = dependencies.createId();
      let rechecked: PreparedBackup | null = null;
      const newPhotoPaths: string[] = [];
      let committed = false;
      let workflowStarted = false;
      try {
        rechecked = await dependencies.validationService.prepare(
          selected.backup.workspace.archiveUri,
          `recheck-${operationId}`,
          ...(observer ? [observer] : []),
        );
        if (await dependencies.restoreRepository.hasCurrentData()) {
          let safety;
          try { safety = await dependencies.backupService.createSafetyArchive(...(observer ? [observer] : [])); }
          catch { throw new Error('无法创建恢复前安全备份，本次恢复已取消，当前数据没有改变。'); }
          try { await dependencies.fileStore.promoteSafetyArchive(safety.uri); }
          catch (error) {
            try { await dependencies.fileStore.deleteArchive(safety.uri); } catch { /* best effort */ }
            throw error;
          }
        }

        await dependencies.workflow?.begin(operationId);
        workflowStarted = !!dependencies.workflow;
        const oldPhotoPaths = await dependencies.restoreRepository.listReferencedPhotoPaths();
        const restoredPhotoMap = new Map<string, string>();
        const manifestEntries = new Map(rechecked.manifest.entries.map((entry) => [entry.path, entry]));
        emitBackupProgress(observer, { stage: 'restore-photos', completed: 0, total: rechecked.photoUris.size, unit: 'files' });
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
          emitBackupProgress(observer, { stage: 'restore-photos', completed: newPhotoPaths.length, total: rechecked.photoUris.size, unit: 'files' });
        }

        emitBackupProgress(observer, { stage: 'replace-data' });
        await dependencies.restoreRepository.replaceAll(rechecked.data, restoredPhotoMap, dependencies.now());
        committed = true;
        emitBackupProgress(observer, { stage: 'post-restore' });
        await attempt('draft-state', async () => dependencies.workflow?.end(operationId, true));
        for (const oldPath of oldPhotoPaths) {
          if (newPhotoPaths.includes(oldPath)) continue;
          await attempt('old-photo-cleanup', () => dependencies.photoGateway.deleteManaged(oldPath));
        }
        await attempt('reminder-sync', async () => {
          if (isReminderSyncError(await dependencies.reminderSync())) throw new Error('reminder-sync');
        });
        return { committed: true as const, warnings };
      } catch (error) {
        if (!committed) {
          if (workflowStarted) {
            try { await dependencies.workflow?.end(operationId, false); }
            catch { /* Persisted restore marker quarantines old drafts on restart. */ }
          }
          for (const newPath of newPhotoPaths) {
            try { await dependencies.photoGateway.deleteManaged(newPath); } catch { /* orphan cleanup fallback */ }
          }
        }
        throw error;
      } finally {
        const cleanup = rechecked ? [rechecked] : [];
        if (prepared === selected) {
          prepared = null;
          cleanup.push(selected.backup);
        }
        for (const item of cleanup) {
          if (committed) await attempt('restore-workspace-cleanup', () => item.dispose());
          else { try { await item.dispose(); } catch { /* Preserve the pre-commit error. */ } }
        }
      }
    });
    // Initialization itself acquires the coordinator for reminder reconciliation.
    // Wait for the real refresh only after releasing the business-write lock.
    state.result = { warnings: [...warnings], busy: true }; publish();
    await attempt('app-refresh', () => dependencies.refreshAppState());
    state.tasks = tasks;
    state.result = warnings.length ? { warnings: [...warnings], busy: false } : null;
    if (!warnings.length) state.completion = selected.action;
    return result;
    } finally {
      state.inFlight = false;
      publish();
    }
  }

  async function hasUndo() {
    return (await dependencies.fileStore.getSafetyArchiveUri()) !== null;
  }

  async function cancelPrepared() {
    await replacePrepared(null);
  }

  async function retryPostRestore() {
    if (!state.result || state.result.busy) return;
    const receipt = state.result;
    state.inFlight = true;
    state.result = { ...receipt, busy: true }; publish();
    try {
      await dependencies.coordinator.runExclusive(async () => {
        const remaining: RecoveryTask[] = [];
        for (const task of state.tasks) {
          if (task.warning === 'app-refresh') { remaining.push(task); continue; }
          try { await task.run(); } catch { remaining.push(task); }
        }
        state.tasks = remaining;
      });
      const remaining: RecoveryTask[] = [];
      for (const task of state.tasks) {
        if (task.warning !== 'app-refresh') { remaining.push(task); continue; }
        try { await task.run(); } catch { remaining.push(task); }
      }
      state.tasks = remaining;
    } finally {
      state.inFlight = false;
      state.result = { warnings: pendingWarnings(), busy: false }; publish();
    }
  }

  function acknowledgeResult() {
    if (state.result?.busy) return;
    state.result = null; state.tasks = []; publish();
  }

  function takeCompletion() {
    const completion = state.completion;
    if (completion !== null) {
      state.completion = null;
      publish();
    }
    return completion;
  }

  return { pickAndPrepare, prepareUndo, confirmPrepared, hasUndo, cancelPrepared, retryPostRestore,
    getResult: () => state.result, acknowledgeResult, getCompletion: () => state.completion, takeCompletion,
    subscribeResult(listener: () => void) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; } };
}

export type RestoreService = ReturnType<typeof createRestoreService>;
