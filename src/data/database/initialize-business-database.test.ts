import { initializeBusinessDatabase, type BusinessDatabase } from './initialize-business-database';
import { MIGRATIONS } from './migrations';

describe('business database initialization', () => {
  test('does not insert constraint probes into the business records table', async () => {
    const executedSql: string[] = [];
    const database: BusinessDatabase = {
      execAsync: async (sql) => {
        executedSql.push(sql);
      },
      getFirstAsync: async <T,>() => ({ user_version: MIGRATIONS.at(-1)?.version ?? 0 }) as T,
      withExclusiveTransactionAsync: async () => {
        throw new Error('No migration should run for an up-to-date database');
      },
    };

    await initializeBusinessDatabase(database);

    expect(executedSql.join('\n')).toMatch(/PRAGMA foreign_keys = ON/i);
    expect(executedSql.join('\n')).not.toMatch(/INSERT\s+INTO\s+records/i);
    expect(executedSql.join('\n')).not.toMatch(/constraint-probe/i);
  });
});
