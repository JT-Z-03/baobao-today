import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { createSQLiteWorkflowStateStore } from './sqlite-workflow-state-store';

let pending: ReturnType<typeof createSQLiteWorkflowStateStore> | null = null;
export function getWorkflowStore() {
  pending ??= SQLite.openDatabaseAsync('baobao-today-workflow.db')
    .then((database) => createSQLiteWorkflowStateStore(database, Crypto.randomUUID))
    .catch((error: unknown) => { pending = null; throw error; });
  return pending;
}
