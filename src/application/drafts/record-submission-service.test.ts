import { createRecordDraftService } from './record-draft-service';
import { createRecordSubmissionService } from './record-submission-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';

function setup() {
  let state = emptyWorkflowState('dataset'); let id = 0;
  const store: WorkflowStateStore = {
    read: async () => structuredClone(state),
    transaction: jest.fn(async (update) => {
      const next = structuredClone(state); const result = update(next); state = next; return result;
    }),
  };
  const drafts = createRecordDraftService(store, () => 100, () => `id-${++id}`);
  const service = createRecordSubmissionService(drafts);
  let record: Record<string, unknown> | null = null;
  const lookup = { getById: async () => record, getByClientRequestId: async () => record };
  return { drafts, service, store, lookup, setRecord: (value: typeof record) => { record = value; } };
}
const scope = { kind: 'other' as const, babyId: 'baby' };
const values = { eventTimeMs: 50, title: '洗澡', note: '还没填完' };

test('a persisted business record is reconciled after the caller loses the response', async () => {
  const { drafts, service, lookup, setRecord } = setup();
  const draft = await drafts.create(scope, values);
  const mutation = jest.fn(async (requestId: string) => {
    setRecord({ id: 'saved', updatedAtMs: 100, ...values, clientRequestId: requestId });
    throw new Error('lost response');
  });
  expect((await service.submit(draft, values, lookup, mutation)).id).toBe('saved');
  expect(mutation).toHaveBeenCalledTimes(1);
  expect((await drafts.list()).drafts).toEqual([]);
});

test('metadata failure after commit retains a frozen request for restart reconciliation', async () => {
  const { drafts, service, lookup, setRecord } = setup();
  const draft = await drafts.create(scope, values);
  const committed = jest.spyOn(drafts, 'committed').mockRejectedValueOnce(new Error('disk full'));
  await expect(service.submit(draft, values, lookup, async (requestId) => {
    setRecord({ id: 'saved', updatedAtMs: 100, ...values, clientRequestId: requestId });
  })).rejects.toThrow('disk full');
  const frozen = (await drafts.get(scope)).draft!;
  expect(frozen.status).toBe('submitting');
  expect(frozen.clientRequestId).toBe(draft.clientRequestId);
  expect((await service.reconcile(frozen, lookup)).kind).toBe('committed');
  expect(committed).toHaveBeenCalledTimes(2);
});

test('known failed creation keeps the raw draft and request ID for retry', async () => {
  const { drafts, service, lookup } = setup();
  const draft = await drafts.create(scope, values);
  await expect(service.submit(draft, values, lookup, async () => { throw new Error('write failed'); })).rejects.toThrow();
  expect((await drafts.get(scope)).draft).toMatchObject({ status: 'editing', values, clientRequestId: draft.clientRequestId });
});

test('changed or deleted edit targets cannot be silently overwritten', async () => {
  const { drafts, service, lookup, setRecord } = setup();
  const draft = await drafts.create({ ...scope, recordId: 'original' }, values, { updatedAtMs: 10 });
  const mutation = jest.fn();
  setRecord({ id: 'original', updatedAtMs: 20 });
  await expect(service.submit(draft, values, lookup, mutation)).rejects.toThrow('原记录已变化');
  setRecord(null);
  await expect(service.submit(draft, values, lookup, mutation)).rejects.toThrow('原记录已变化');
  expect(mutation).not.toHaveBeenCalled();
  expect((await drafts.get({ ...scope, recordId: 'original' })).draft?.values).toEqual(values);
});

test('ambiguous photo replacement stays available for manual reconciliation', async () => {
  const { drafts, service, lookup, setRecord } = setup();
  const draft = await drafts.create({ ...scope, recordId: 'original' }, values, { updatedAtMs: 10 });
  const frozen = await drafts.freeze(draft.id, { photoChange: { kind: 'replace', source: { uri: 'file://draft' } } });
  setRecord({ id: 'original', updatedAtMs: 20, photoUri: 'file://normalized' });
  expect((await service.reconcile(frozen, lookup)).kind).toBe('conflict');
  expect((await drafts.list()).drafts).toHaveLength(1);
});

test('restore invalidates an old request before its mutation executes', async () => {
  const { drafts, service, lookup } = setup();
  const draft = await drafts.create(scope, values); const mutation = jest.fn();
  await drafts.beginRestore('restore'); await drafts.endRestore('restore', true);
  await expect(service.submit(draft, values, lookup, mutation)).rejects.toThrow('资料已恢复');
  expect(mutation).not.toHaveBeenCalled();
});
