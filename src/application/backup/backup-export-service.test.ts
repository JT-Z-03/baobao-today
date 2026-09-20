import { createBackupExportService } from './backup-export-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';
import type { BackupExportGateway } from '@/application/ports/backup-export';

function setup() {
  let state = emptyWorkflowState('dataset-1');
  const store: WorkflowStateStore = { read: async () => structuredClone(state), transaction: async (operation) => {
    const next = structuredClone(state); const result = operation(next); state = next; return result;
  } };
  const fingerprint = { byteLength: 30, sha256: 'a'.repeat(64) };
  const gateway: jest.Mocked<BackupExportGateway> = {
    fingerprint: jest.fn(async (_uri) => fingerprint), chooseTarget: jest.fn(async (_filename) => ({ uri: 'content://file', filename: 'backup.zip', location: '我的备份' })),
    write: jest.fn(async (_source, _target) => undefined), deleteCreated: jest.fn(async (_uri) => undefined),
  };
  const share = { isAvailable: jest.fn(async () => true), share: jest.fn(async () => undefined) };
  let id = 0;
  const service = createBackupExportService({ store, gateway, share, now: () => 100, createId: () => String(++id),
    coordinator: { busy: false, runExclusive: async (task) => task() },
    backup: { createExportArchive: jest.fn(async () => ({ filename: 'backup.zip', uri: 'file://source', manifest: {} })) as never },
  });
  return { service, store, gateway, share };
}

test('sharing and canceling do not create a verified save receipt', async () => {
  const { service, gateway, store } = setup(); const generated = await service.create();
  await service.share(generated);
  gateway.chooseTarget.mockResolvedValueOnce(null);
  expect(await service.save(generated)).toEqual({ kind: 'canceled' });
  expect((await store.read()).exports).toEqual([]);
});
test('only matching readback records a successful save and concurrent taps share one write', async () => {
  const { service, gateway } = setup(); const generated = await service.create();
  const results = await Promise.all([service.save(generated), service.save(generated)]);
  expect(results[0].kind).toBe('verified'); expect(gateway.write).toHaveBeenCalledTimes(1);
  expect((await service.latest())?.savedAtMs).toBe(100);
});
test('failed readback keeps the file but cannot claim it was verified', async () => {
  const { service, gateway } = setup(); const generated = await service.create();
  gateway.fingerprint.mockRejectedValueOnce(new Error('permission revoked'));
  expect((await service.save(generated)).kind).toBe('unverified');
  expect(gateway.deleteCreated).not.toHaveBeenCalled(); expect(await service.latest()).toBeNull();
});
test('mismatch cleans only the new destination and leaves the source for retry', async () => {
  const { service, gateway } = setup(); const generated = await service.create();
  gateway.fingerprint.mockResolvedValueOnce({ byteLength: 29, sha256: 'b'.repeat(64) });
  expect((await service.save(generated)).kind).toBe('failed');
  expect(gateway.deleteCreated).toHaveBeenCalledWith('content://file'); expect(await service.latest()).toBeNull();
});
test('restoring another dataset does not label a historical backup as its latest backup', async () => {
  const { service, store } = setup(); const generated = await service.create();
  await store.transaction((state) => { state.generation = 'dataset-2'; });
  expect((await service.save(generated)).kind).toBe('verified'); expect(await service.latest()).toBeNull();
});

test('a failed write cleans only its destination and never records a successful save', async () => {
  const { service, gateway } = setup(); const generated = await service.create();
  gateway.write.mockRejectedValueOnce(new Error('no space left'));
  expect((await service.save(generated)).kind).toBe('failed');
  expect(gateway.deleteCreated).toHaveBeenCalledTimes(1);
  expect(gateway.deleteCreated).toHaveBeenCalledWith('content://file');
  expect(await service.latest()).toBeNull();
  expect((await service.save(generated)).kind).toBe('verified');
});

test('restart reconciles interrupted writes from actual bytes, keeping unreadable targets unverified', async () => {
  const { service, gateway, store } = setup(); const generated = await service.create();
  await store.transaction((state) => {
    state.exports = ['complete', 'partial', 'revoked'].map((id) => ({
      ...generated, id, uri: `content://${id}`, filename: `${id}.zip`, location: '我的备份', status: 'writing', savedAtMs: null,
    }));
  });
  gateway.fingerprint
    .mockResolvedValueOnce({ byteLength: generated.byteLength, sha256: generated.sha256 })
    .mockResolvedValueOnce({ byteLength: 3, sha256: 'b'.repeat(64) })
    .mockRejectedValueOnce(new Error('permission revoked'));
  await service.reconcilePending();
  expect((await store.read()).exports.map(({ id, status, savedAtMs }) => ({ id, status, savedAtMs })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: 'complete', status: 'verified', savedAtMs: 100 },
    { id: 'partial', status: 'failed', savedAtMs: null },
    { id: 'revoked', status: 'unverified', savedAtMs: null },
  ]);
  expect((await service.latest())?.id).toBe('complete');
  expect(gateway.write).not.toHaveBeenCalled();
  expect(gateway.deleteCreated).not.toHaveBeenCalled();
});
