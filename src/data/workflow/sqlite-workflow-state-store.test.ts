/** @jest-environment node */
// @ts-expect-error Node 24 provides SQLite; application intentionally omits Node typings.
import { DatabaseSync } from 'node:sqlite';
import { createSQLiteWorkflowStateStore, type WorkflowDatabase } from './sqlite-workflow-state-store';
import { createRecordDraftService } from '@/application/drafts/record-draft-service';

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  const query = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    getFirstAsync: async <T,>(sql: string, ...args: (string | number | null)[]) =>
      (sqlite.prepare(sql).get(...args) as T | undefined) ?? null,
    runAsync: async (sql: string, ...args: (string | number | null)[]) => {
      const result = sqlite.prepare(sql).run(...args);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
  };
  const database: WorkflowDatabase = { ...query, withExclusiveTransactionAsync: async (task) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { await task(query); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  let id = 0;
  const store = await createSQLiteWorkflowStateStore(database, () => `id-${++id}`);
  const service = createRecordDraftService(store, () => 1_000, () => `id-${++id}`);
  return { sqlite, store, service, database };
}

const scope = { babyId: 'baby', kind: 'pee' as const };
const values = { eventTimeMs: 1_000, amount: null, color: null, note: '没填完' };

test('recovering a quarantined timer retains measured time as a finished draft for review', async () => {
  const { sqlite, store } = await setup(); let now = 1_000; let id = 0;
  const service = createRecordDraftService(store, () => now, () => `timer-${++id}`);
  try {
    const draft = await service.create({ babyId: 'baby', kind: 'feeding' }, { eventTimeMs: now, feedingType: 'breast', milkAmount: '', breastMilkAmount: '', leftDuration: '0', rightDuration: '0', note: '', mixedComponents: [] });
    await service.timerAction(draft.id, { type: 'start', side: 'left' }); now += 120_000;
    await service.beginRestore('restore'); now += 600_000;
    const recovered = await service.recoverAsNew(draft.id);
    expect(recovered.timer).toMatchObject({ finished: true, side: null, leftMs: 120_000 });
    expect(recovered.values).toMatchObject({ leftDuration: '2', rightDuration: '0' });
    expect((await service.list()).drafts).toHaveLength(1);
  } finally { sqlite.close(); }
});

test('reopening retains confirmed raw values and the original request ID', async () => {
  const { sqlite, service, database } = await setup();
  try {
    const draft = await service.create(scope, values);
    const reopened = await createSQLiteWorkflowStateStore(database, () => 'unused');
    expect((await reopened.read()).drafts[draft.key]).toEqual(draft);
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
  } finally { sqlite.close(); }
});

test('discard and committed markers reject late writes', async () => {
  const { sqlite, service } = await setup();
  try {
    const draft = await service.create(scope, values);
    await service.freeze(draft.id, { eventTimeMs: 1_000 });
    await service.committed(draft.id, 'saved-record');
    await expect(service.update(draft.id, values)).rejects.toThrow();
    await service.discard(draft.id);
    await expect(service.update(draft.id, values)).rejects.toThrow();
    expect((await service.list()).drafts).toEqual([]);
  } finally { sqlite.close(); }
});

test('interrupted restore quarantines old drafts and blocks submitting them', async () => {
  const { sqlite, service, store } = await setup();
  try {
    const draft = await service.create(scope, values);
    await service.beginRestore('restore');
    const restarted = createRecordDraftService(store, Date.now, () => 'new-id');
    expect((await restarted.get(scope)).quarantined).toBe(true);
    await expect(restarted.freeze(draft.id, {})).rejects.toThrow();
    await restarted.endRestore('restore', true);
    expect((await restarted.list()).drafts).toEqual([]);
    await expect(restarted.assertGeneration(draft.generation)).rejects.toThrow();
  } finally { sqlite.close(); }
});

test('a failed transaction retains the previous state', async () => {
  const { sqlite, store } = await setup();
  try {
    const before = await store.read();
    await expect(store.transaction((state) => { state.generation = 'bad'; throw new Error('disk'); })).rejects.toThrow('disk');
    expect(await store.read()).toEqual(before);
  } finally { sqlite.close(); }
});

test('an interrupted restore with no drafts can be acknowledged without blocking every future record', async () => {
  const { sqlite, service } = await setup();
  try {
    const before = (await service.list()).generation;
    await service.beginRestore('restore');
    await service.resolveInterruptedRestore();
    expect((await service.list()).generation).not.toBe(before);
    const draft = await service.create(scope, values);
    await expect(service.assertGeneration(draft.generation)).resolves.toBeUndefined();
  } finally { sqlite.close(); }
});

test('recovering an old edit cannot overwrite an old pending new draft of the same kind', async () => {
  const { sqlite, service } = await setup();
  try {
    const fresh = await service.create(scope, values);
    const edit = await service.create({...scope, recordId:'existing'}, {...values, note:'edited'});
    await service.beginRestore('restore'); await service.resolveInterruptedRestore();
    await expect(service.recoverAsNew(edit.id)).rejects.toThrow('已有同类草稿');
    expect((await service.list()).drafts.map(item => item.id).sort()).toEqual([fresh.id, edit.id].sort());
  } finally { sqlite.close(); }
});
