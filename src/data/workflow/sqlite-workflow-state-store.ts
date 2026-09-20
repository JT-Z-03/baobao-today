import { emptyWorkflowState, type WorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';
import { WORKFLOW_SCHEMA_SQL, WORKFLOW_SCHEMA_VERSION } from './workflow-schema';

type Query = {
  getFirstAsync<T>(sql: string, ...args: (string | number | null)[]): Promise<T | null>;
  runAsync(sql: string, ...args: (string | number | null)[]): Promise<unknown>;
  execAsync(sql: string): Promise<void>;
};
export type WorkflowDatabase = Query & {
  withExclusiveTransactionAsync(task: (transaction: Query) => Promise<void>): Promise<void>;
};

function parseState(value: string): WorkflowState {
  const state = JSON.parse(value) as WorkflowState;
  if (state.format !== 1 || typeof state.generation !== 'string' || !state.generation
    || !state.drafts || typeof state.drafts !== 'object' || !Array.isArray(state.exports)) {
    throw new Error('本机草稿数据无法读取，原文件已保留，请重试');
  }
  return state;
}

export async function createSQLiteWorkflowStateStore(
  database: WorkflowDatabase, createId: () => string,
): Promise<WorkflowStateStore> {
  await database.withExclusiveTransactionAsync(async (tx) => {
    const version = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (version && version.user_version > WORKFLOW_SCHEMA_VERSION) throw new Error('草稿来自更新版本，请更新应用');
    await tx.execAsync(WORKFLOW_SCHEMA_SQL);
    await tx.runAsync('INSERT OR IGNORE INTO workflow_state(id, value) VALUES(1, ?)', JSON.stringify(emptyWorkflowState(createId())));
  });
  const readFrom = async (query: Query) => {
    const row = await query.getFirstAsync<{ value: string }>('SELECT value FROM workflow_state WHERE id = 1');
    if (!row) throw new Error('本机草稿状态缺失，请重试');
    return parseState(row.value);
  };
  // Reads also enter this queue so they cannot observe a partially updated transaction.
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>) => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    read: () => serialized(() => readFrom(database)),
    transaction: <T>(update: (state: WorkflowState) => T) => serialized(async () => {
      let result!: T;
      await database.withExclusiveTransactionAsync(async (tx) => {
        const state = await readFrom(tx);
        result = update(state);
        await tx.runAsync('UPDATE workflow_state SET value = ? WHERE id = 1', JSON.stringify(state));
      });
      return result;
    }),
  };
}
