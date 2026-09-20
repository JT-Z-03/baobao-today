import type { BackupService } from './backup-service';
import type { BackupOperationCoordinator, BackupShareGateway } from '@/application/ports/backup';
import type { BackupExportGateway, BackupExportReceipt, BackupFileFingerprint } from '@/application/ports/backup-export';
import type { WorkflowStateStore } from '@/application/ports/workflow-state';

export type GeneratedBackup = BackupFileFingerprint & { id: string; sourceUri: string; filename: string; generation: string; createdAtMs: number };
type SaveResult = { kind: 'canceled' } | { kind: 'verified' | 'unverified' | 'failed'; receipt: BackupExportReceipt; cleanupFailed?: boolean };
type Dependencies = { backup: Pick<BackupService, 'createExportArchive'>; gateway: BackupExportGateway;
  store: WorkflowStateStore; share: BackupShareGateway; coordinator: BackupOperationCoordinator; now(): number; createId(): string };

export function createBackupExportService(deps: Dependencies) {
  let saving: Promise<SaveResult> | null = null;
  const matches = (a: BackupFileFingerprint, b: BackupFileFingerprint) => a.byteLength === b.byteLength && a.sha256 === b.sha256;
  const update = async (receipt: BackupExportReceipt) => deps.store.transaction((state) => {
    const index = state.exports.findIndex((item) => item.id === receipt.id);
    if (index < 0) state.exports.push(receipt); else state.exports[index] = receipt;
    // Keep unfinished writes for reconciliation, and the 20 most recent finished receipts.
    const completed = state.exports.filter((item) => item.status !== 'writing').slice(-20);
    state.exports = [...state.exports.filter((item) => item.status === 'writing'), ...completed];
  });

  async function saveOnce(generated: GeneratedBackup): Promise<SaveResult> {
    const target = await deps.gateway.chooseTarget(generated.filename);
    if (!target) return { kind: 'canceled' };
    let receipt: BackupExportReceipt = { ...generated, ...target, id: deps.createId(), status: 'writing', savedAtMs: null };
    try { await update(receipt); }
    catch (error) { await deps.gateway.deleteCreated(target.uri).catch(() => undefined); throw error; }
    try { await deps.gateway.write(generated.sourceUri, target.uri); }
    catch {
      let cleanupFailed = false;
      await deps.gateway.deleteCreated(target.uri).catch(() => { cleanupFailed = true; });
      receipt = { ...receipt, status: 'failed' }; await update(receipt);
      return { kind: 'failed', receipt, cleanupFailed };
    }
    let actual: BackupFileFingerprint;
    try { actual = await deps.gateway.fingerprint(target.uri); }
    catch {
      receipt = { ...receipt, status: 'unverified' }; await update(receipt);
      return { kind: 'unverified', receipt };
    }
    if (!matches(generated, actual)) {
      let cleanupFailed = false;
      await deps.gateway.deleteCreated(target.uri).catch(() => { cleanupFailed = true; });
      receipt = { ...receipt, status: 'failed' }; await update(receipt);
      return { kind: 'failed', receipt, cleanupFailed };
    }
    receipt = { ...receipt, status: 'verified', savedAtMs: deps.now() }; await update(receipt);
    return { kind: 'verified', receipt };
  }

  return {
    async create(): Promise<GeneratedBackup> {
      return deps.coordinator.runExclusive(async () => {
        const state = await deps.store.read();
        if (state.restore) throw new Error('请先核对恢复后的未完成记录，再备份');
        const archive = await deps.backup.createExportArchive();
        const fingerprint = await deps.gateway.fingerprint(archive.uri);
        return { ...fingerprint, id: deps.createId(), sourceUri: archive.uri, filename: archive.filename,
          generation: state.generation, createdAtMs: deps.now() };
      });
    },
    save(generated: GeneratedBackup) {
      saving ??= saveOnce(generated).finally(() => { saving = null; });
      return saving;
    },
    async share(generated: GeneratedBackup) {
      if (!await deps.share.isAvailable()) throw new Error('当前设备无法打开分享面板');
      await deps.share.share(generated.sourceUri, generated.filename);
    },
    async latest() {
      const state = await deps.store.read();
      return state.exports.filter((item) => item.status === 'verified' && item.generation === state.generation)
        .sort((a, b) => (b.savedAtMs ?? 0) - (a.savedAtMs ?? 0))[0] ?? null;
    },
    async check(receipt: BackupExportReceipt) {
      try { return matches(receipt, await deps.gateway.fingerprint(receipt.uri)); } catch { return false; }
    },
    async reconcilePending() {
      const state = await deps.store.read();
      for (const receipt of state.exports.filter((item) => item.status === 'writing')) {
        try {
          const fingerprint = await deps.gateway.fingerprint(receipt.uri);
          await update({ ...receipt, status: matches(receipt, fingerprint) ? 'verified' : 'failed',
            savedAtMs: matches(receipt, fingerprint) ? deps.now() : null });
        } catch { await update({ ...receipt, status: 'unverified' }); }
      }
    },
  };
}
export type BackupExportService = ReturnType<typeof createBackupExportService>;
