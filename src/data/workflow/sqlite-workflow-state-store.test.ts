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
    await service.freeze(draft.id, { ...values, note: null });
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

test('legacy payload reads without rewriting and upgrades only on a successful mutation', async () => {
  const { sqlite, store, service } = await setup();
  try {
    const draft = await service.create(scope, values);
    const legacyState = { ...await store.read() } as Record<string, unknown>;
    delete legacyState.payloadVersion;
    const legacy = JSON.stringify(legacyState);
    sqlite.prepare('UPDATE workflow_state SET value = ? WHERE id = 1').run(legacy);
    expect((await store.read()).drafts[draft.key]).toEqual(draft);
    expect(sqlite.prepare('SELECT value FROM workflow_state').get().value).toBe(legacy);
    await service.update(draft.id, { ...values, note: '继续编辑' });
    expect(JSON.parse(sqlite.prepare('SELECT value FROM workflow_state').get().value)).toMatchObject({ format: 1, payloadVersion: 1 });
    expect(sqlite.prepare('PRAGMA user_version').get().user_version).toBe(1);
  } finally { sqlite.close(); }
});

test.each([
  ['future version', (state: Record<string, unknown>) => { state.payloadVersion = 99; }],
  ['draft array', (state: Record<string, unknown>) => { state.drafts = []; }],
  ['invalid restore', (state: Record<string, unknown>) => { state.restore = { id: 'restore' }; }],
  ['invalid receipt', (state: Record<string, unknown>) => { state.exports = [{ status: 'verified' }]; }],
])('%s is rejected without overwriting the persisted original', async (_name, corrupt) => {
  const { sqlite, store, service, database } = await setup();
  try {
    await service.create(scope, values);
    const invalid = await store.read(); corrupt(invalid);
    const raw = JSON.stringify(invalid);
    sqlite.prepare('UPDATE workflow_state SET value = ? WHERE id = 1').run(raw);
    const reopened = await createSQLiteWorkflowStateStore(database, () => 'must-not-reset');
    await expect(reopened.read()).rejects.toThrow();
    await expect(reopened.transaction((state) => { state.drafts = {}; })).rejects.toThrow();
    expect(sqlite.prepare('SELECT value FROM workflow_state').get().value).toBe(raw);
  } finally { sqlite.close(); }
});

test('invalid new writes roll back, while an already isolated entry never replaces a healthy entry with the same key', async () => {
  const { sqlite, store, service } = await setup();
  try {
    const healthy = await service.create(scope, values);
    const before = sqlite.prepare('SELECT value FROM workflow_state').get().value;
    await expect(store.transaction((state) => { state.drafts[healthy.key].values.note = null as never; })).rejects.toThrow('写入结构异常');
    expect(sqlite.prepare('SELECT value FROM workflow_state').get().value).toBe(before);
    await store.transaction((state) => { state.quarantinedDrafts = [{ key: healthy.key, raw: '{"old":"broken"}', reason: '保留旧异常内容' }]; });
    expect((await store.read()).drafts[healthy.key]).toEqual(healthy);
    await service.update(healthy.id, { ...values, note: 'healthy same key' });
    expect((await store.read()).quarantinedDrafts).toEqual([{ key: healthy.key, raw: '{"old":"broken"}', reason: '保留旧异常内容' }]);
  } finally { sqlite.close(); }
});

test.each(['values', 'timer', 'key', 'photo', 'empty-submission', 'photo-submission', 'base-record'])('isolates malformed %s while preserving healthy drafts and the original bad value across restart', async (field) => {
  const { sqlite, store, service, database } = await setup();
  try {
    const healthy = await service.create(scope, values);
    const bad = await service.create({ babyId: 'baby', kind: 'poop' }, {
      eventTimeMs: 1000, note: '', amount: null, color: null, texture: null, previewUri: 'file://retained',
      photoChange: { kind: 'replace', source: { uri: 'file://retained', width: 20, height: 20 } },
    });
    const state = await store.read();
    const broken = state.drafts[bad.key] as unknown as Record<string, unknown>;
    if (field === 'values') broken.values = { note: {} };
    if (field === 'timer') broken.timer = { side: 'left' };
    if (field === 'key') broken.key = 'mismatched-key';
    if (field === 'photo') (broken.values as Record<string, unknown>).photoChange = { kind: 'replace', source: { uri: 'file://retained' } };
    if (field === 'empty-submission') { broken.status = 'submitting'; broken.submission = {}; }
    if (field === 'photo-submission') { broken.status = 'submitting'; broken.submission = { eventTimeMs: 1000, color: null, texture: null, amount: null, note: null, photoChange: null }; }
    if (field === 'base-record') broken.baseRecord = { id: 'wrong', updatedAtMs: 'invalid' };
    const rawDraft = JSON.stringify(broken); const original = JSON.stringify(state);
    sqlite.prepare('UPDATE workflow_state SET value = ? WHERE id = 1').run(original);
    const reopened = await createSQLiteWorkflowStateStore(database, () => 'unused');
    expect((await reopened.read()).drafts).toEqual({ [healthy.key]: healthy });
    expect(sqlite.prepare('SELECT value FROM workflow_state').get().value).toBe(original);
    const restarted = createRecordDraftService(reopened, () => 2000, () => 'new');
    await restarted.update(healthy.id, { ...values, note: 'healthy continues' });
    expect((await reopened.read()).quarantinedDrafts).toEqual([{ key: bad.key, raw: rawDraft, reason: expect.any(String) }]);
    await expect(restarted.create({ babyId: 'baby', kind: 'poop' }, bad.values as never)).rejects.toThrow('隔离保留');
    const again = await createSQLiteWorkflowStateStore(database, () => 'unused');
    expect((await again.read()).quarantinedDrafts).toHaveLength(1);
    expect((await again.read()).drafts[healthy.key].values.note).toBe('healthy continues');
    expect(sqlite.prepare('PRAGMA user_version').get().user_version).toBe(1);
  } finally { sqlite.close(); }
});

test('duplicate request IDs are isolated together instead of reconciling one draft as another saved record', async () => {
  const { sqlite, store, service } = await setup();
  try {
    const first = await service.create(scope, values);
    const second = await service.create({ ...scope, babyId: 'second' }, values);
    const state = await store.read(); state.drafts[second.key].clientRequestId = first.clientRequestId;
    sqlite.prepare('UPDATE workflow_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    expect((await store.read()).drafts).toEqual({});
    expect((await store.read()).quarantinedDrafts).toHaveLength(2);
  } finally { sqlite.close(); }
});
