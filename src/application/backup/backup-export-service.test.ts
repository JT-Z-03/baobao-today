import { createBackupExportService } from './backup-export-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';
import type { BackupExportGateway, BackupExportReceipt } from '@/application/ports/backup-export';

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
  const backup = { createExportArchive: jest.fn(async () => ({ filename: 'backup.zip', uri: 'file://source', manifest: {} })) };
  const service = createBackupExportService({ store, gateway, share, now: () => 100, createId: () => String(++id),
    coordinator: { busy: false, runExclusive: async (task) => task() },
    backup: backup as never,
  });
  return { service, store, gateway, share, backup };
}

test('forwards creation progress and identifies the final fingerprint stage', async () => {
  const { service, backup } = setup(); const progress = jest.fn();
  await service.create(progress);
  expect(backup.createExportArchive).toHaveBeenCalledWith(progress);
  expect(progress).toHaveBeenLastCalledWith({ stage: 'verify-export' });
});

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

test('the twenty-first save keeps its receipt and evicts the oldest completed save', async () => {
  const { service, store } = setup();
  const generated = await service.create();
  const savedIds: string[] = [];
  for (let index = 0; index < 21; index += 1) {
    const result = await service.save(generated);
    expect(result.kind).toBe('verified');
    if (result.kind === 'canceled') throw new Error('Expected a saved receipt');
    savedIds.push(result.receipt.id);
  }

  expect((await store.read()).exports.map((receipt) => receipt.id)).toEqual(savedIds.slice(1));
});

test('a fresh save after restore remains the latest when twenty historical receipts exist', async () => {
  const { service, store } = setup();
  const previous = await service.create();
  for (let index = 0; index < 20; index += 1) await service.save(previous);
  await store.transaction((state) => { state.generation = 'dataset-2'; });
  expect(await service.latest()).toBeNull();

  const current = await service.create();
  const result = await service.save(current);
  expect(result.kind).toBe('verified');
  if (result.kind === 'canceled') throw new Error('Expected a saved receipt');
  expect(await service.latest()).toEqual(result.receipt);
  expect((await store.read()).exports).toHaveLength(20);
});

test('retention recognizes the oldest receipt in an existing reverse-ordered history', async () => {
  const { service, store } = setup();
  const generated = await service.create();
  await store.transaction((state) => {
    state.exports = Array.from({ length: 20 }, (_, index) => ({
      ...generated, id: `historical-${20 - index}`, savedAtMs: 20 - index,
      uri: `content://historical-${20 - index}`, location: '我的备份', status: 'verified',
    }));
  });

  const result = await service.save(generated);
  expect(result.kind).toBe('verified');
  if (result.kind === 'canceled') throw new Error('Expected a saved receipt');
  const receipts = (await store.read()).exports;
  expect(receipts).toHaveLength(20);
  expect(receipts.some((receipt) => receipt.id === 'historical-1')).toBe(false);
  expect(receipts.some((receipt) => receipt.id === 'historical-20')).toBe(true);
  expect(await service.latest()).toEqual(result.receipt);
});

test.each(['verified', 'unverified', 'failed'] as const)(
  'retains other unfinished writes when a full history receives a %s result',
  async (status) => {
    const { service, gateway, store } = setup();
    const generated = await service.create();
    for (let index = 0; index < 20; index += 1) await service.save(generated);
    const completedBefore = (await store.read()).exports;
    const unfinished: BackupExportReceipt[] = ['pending-first', 'pending-second'].map((id) => ({
      ...generated, id, uri: `content://${id}`, location: '我的备份', status: 'writing', savedAtMs: null,
    }));
    await store.transaction((state) => { state.exports.unshift(...unfinished); });
    let finishWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    gateway.write.mockImplementationOnce(async () => {
      writeStarted();
      await new Promise<void>((resolve) => { finishWrite = resolve; });
    });
    if (status === 'unverified') gateway.fingerprint.mockRejectedValueOnce(new Error('permission revoked'));
    if (status === 'failed') gateway.fingerprint.mockResolvedValueOnce({ byteLength: 1, sha256: 'b'.repeat(64) });

    const saving = service.save(generated);
    await started;
    const duringWrite = (await store.read()).exports;
    expect(duringWrite.filter((receipt) => receipt.status === 'writing')).toHaveLength(3);
    expect(duringWrite.filter((receipt) => receipt.status !== 'writing')).toEqual(completedBefore);
    finishWrite();
    const result = await saving;
    expect(result.kind).toBe(status);
    if (result.kind === 'canceled') throw new Error('Expected a saved receipt');

    const afterWrite = (await store.read()).exports;
    expect(afterWrite.filter((receipt) => receipt.status === 'writing')).toEqual(unfinished);
    expect(afterWrite.filter((receipt) => receipt.status !== 'writing')).toEqual([
      ...completedBefore.slice(1), result.receipt,
    ]);
  },
);

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

test('deferred reconciliation only inspects startup receipts and cannot overwrite a newer verdict', async () => {
  const { service, gateway, store } = setup(); const generated = await service.create();
  const receipt = { ...generated, id: 'old', uri: 'content://old', location: '', status: 'writing' as const, savedAtMs: null };
  await store.transaction((state) => { state.exports = [receipt, { ...receipt, id: 'new', uri: 'content://new' }]; });
  let finish!: (value: { byteLength: number; sha256: string }) => void;
  gateway.fingerprint.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = service.reconcilePending({ receiptIds: new Set(['old']) });
  await Promise.resolve();
  await store.transaction((state) => { state.exports[0].status = 'failed'; });
  finish(generated); await pending;
  expect((await store.read()).exports.map((item) => item.status)).toEqual(['failed', 'writing']);
  expect(gateway.fingerprint).not.toHaveBeenCalledWith('content://new');
});

test('canceled reconciliation leaves interrupted receipt for the next initialization', async () => {
  const { service, gateway, store } = setup(); const generated = await service.create();
  await store.transaction((state) => { state.exports = [{ ...generated, id: 'old', uri: 'content://old', location: '', status: 'writing', savedAtMs: null }]; });
  let active = true;
  gateway.fingerprint.mockImplementationOnce(async () => { active = false; return generated; });
  await service.reconcilePending({ isActive: () => active });
  expect((await store.read()).exports[0].status).toBe('writing');
});
