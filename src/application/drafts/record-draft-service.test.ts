import { createRecordDraftService } from './record-draft-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';
import type { DraftValues } from '@/domain/drafts/record-draft';

function setup() {
  let state = emptyWorkflowState('dataset'); let id = 0; let nowMs = 1_000;
  const store: WorkflowStateStore = {
    read: async () => structuredClone(state),
    transaction: async (update) => {
      const next = structuredClone(state); const result = update(next); state = next; return result;
    },
  };
  return { store, drafts: createRecordDraftService(store, () => nowMs, () => `id-${++id}`),
    advance: (duration: number) => { nowMs += duration; } };
}
const values: DraftValues['feeding'] = {
  eventTimeMs: 1_000, feedingType: 'breast', milkAmount: '', breastMilkAmount: '', leftDuration: '',
  rightDuration: '', note: '', mixedComponents: [],
};

test('R04: quarantined old timer does not block the current baby, and recovery preserves accumulated minutes', async () => {
  const { drafts, advance } = setup();
  const old = await drafts.create({ babyId: 'old-baby', kind: 'feeding' }, values);
  await drafts.timerAction(old.id, { type: 'start', side: 'left' });
  advance(120_000);
  await drafts.beginRestore('interrupted');
  await drafts.resolveInterruptedRestore();
  const current = await drafts.create({ babyId: 'current-baby', kind: 'feeding' }, values);
  await expect(drafts.timerAction(old.id, { type: 'start', side: 'right' })).rejects.toThrow('草稿状态已变化');
  await expect(drafts.timerAction(current.id, { type: 'start', side: 'right' })).resolves.toMatchObject({
    babyId: 'current-baby', timer: { side: 'right', finished: false },
  });
  await drafts.discard(current.id);
  const recovered = await drafts.recoverAsNew(old.id, 'current-baby');
  expect(recovered).toMatchObject({ babyId: 'current-baby', values: { leftDuration: '2', rightDuration: '0' }, timer: { finished: true } });
  expect((await drafts.get({ babyId: 'current-baby', kind: 'feeding' })).quarantined).toBe(false);
});

test('R04: a paused timer in the current dataset and baby still blocks a second timer', async () => {
  const { drafts, store } = setup();
  const first = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await drafts.timerAction(first.id, { type: 'start', side: 'left' });
  await drafts.timerAction(first.id, { type: 'pause' });
  // A persisted second pending item can exist after interruption/recovery; both are still current.
  await store.transaction((state) => {
    const item = state.drafts[first.key];
    delete state.drafts[first.key];
    item.key = 'baby:feeding:preserved'; state.drafts[item.key] = item;
  });
  const second = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await expect(drafts.timerAction(second.id, { type: 'start', side: 'right' })).rejects.toThrow('已有亲喂计时');
  expect((await drafts.get({ babyId: 'baby', kind: 'feeding' })).draft?.timer).toBeNull();
});

test('R04: another baby in the same generation does not occupy the current timer', async () => {
  const { drafts } = setup();
  const first = await drafts.create({ babyId: 'other-baby', kind: 'feeding' }, values);
  await drafts.timerAction(first.id, { type: 'start', side: 'left' });
  const second = await drafts.create({ babyId: 'current-baby', kind: 'feeding' }, values);
  await expect(drafts.timerAction(second.id, { type: 'start', side: 'right' })).resolves.toMatchObject({ timer: { side: 'right' } });
});

test('R15: discard retains its removed-draft return contract, including a missing ID', async () => {
  const { drafts } = setup();
  const draft = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await expect(drafts.discard(draft.id)).resolves.toEqual(draft);
  await expect(drafts.discard(draft.id)).resolves.toBeNull();
});

test('R15: ordinary and non-final discards return the committed generation without another read', async () => {
  const { drafts, store } = setup();
  const ordinary = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  const read = jest.spyOn(store, 'read').mockRejectedValue(new Error('read unavailable'));
  await expect(drafts.discardWithGeneration(ordinary.id)).resolves.toEqual({
    draft: ordinary, generation: 'dataset', generationChanged: false,
  });
  expect(read).not.toHaveBeenCalled(); read.mockRestore();
  const first = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await drafts.create({ babyId: 'another-baby', kind: 'feeding' }, values);
  await drafts.beginRestore('interrupted');
  await expect(drafts.discardWithGeneration(first.id)).resolves.toEqual({
    draft: first, generation: 'dataset', generationChanged: false,
  });
  expect((await store.read()).restore?.id).toBe('interrupted');
});

test('R15: last isolated discard reports its changed generation and a repeated discard stays idempotent', async () => {
  const { drafts, store } = setup();
  const draft = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await drafts.beginRestore('interrupted');
  const result = await drafts.discardWithGeneration(draft.id);
  expect(result.draft).toEqual(draft);
  expect(result.generationChanged).toBe(true);
  expect(result.generation).not.toBe('dataset');
  expect(await store.read()).toMatchObject({ generation: result.generation, restore: null, drafts: {} });
  await expect(drafts.discardWithGeneration(draft.id)).resolves.toEqual({
    draft: null, generation: result.generation, generationChanged: false,
  });
  await expect(drafts.assertGeneration('dataset')).rejects.toThrow('资料已恢复');
  await expect(drafts.assertGeneration(result.generation)).resolves.toBeUndefined();
});

test('R15: a rejected discard transaction retains the isolated draft and generation for retry', async () => {
  const { drafts, store } = setup();
  const draft = await drafts.create({ babyId: 'baby', kind: 'feeding' }, values);
  await drafts.beginRestore('interrupted'); const before = await store.read();
  const transaction = jest.spyOn(store, 'transaction').mockRejectedValueOnce(new Error('disk'));
  await expect(drafts.discardWithGeneration(draft.id)).rejects.toThrow('disk');
  expect(await store.read()).toEqual(before);
  transaction.mockRestore();
  await expect(drafts.discardWithGeneration(draft.id)).resolves.toMatchObject({ generationChanged: true });
});
