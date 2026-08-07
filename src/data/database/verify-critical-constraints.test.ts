import { RECORDS_FINAL_OBJECT_NAMES, RECORDS_V6_OBJECT_NAMES } from './records-schema';
import {
  VERIFICATION_DATABASE_NAME,
  verifyCriticalConstraintsInIsolatedDatabase,
  type VerificationDependencies,
} from './verify-critical-constraints';

describe('native migration verification isolation', () => {
  test('uses a disposable v4 fixture, reopens it after migration, and always deletes it', async () => {
    let userVersion = 4;
    let repositoryVerified = false;
    let bottledRow: Record<string, unknown> | null = null;
    let insideTransaction = false;
    let invalidMixedAttempted = false;
    const execAsync = jest.fn(async () => undefined);
    const getFirstAsync = jest.fn(async (sql: string, ...params: (string | number | null)[]) => {
        if (/PRAGMA user_version/i.test(sql)) return { user_version: userVersion };
        if (/pragma_table_info/i.test(sql)) return { name: 'breast_milk_amount_ml' };
        if (/WHERE id = \?/i.test(sql) && params[0] === 'constraint-probe-bottle') return bottledRow;
        if (/WHERE client_request_id = \?/i.test(sql)) return null;
        if (/type='sleep'/i.test(sql)) return { count: 0 };
        if (/COUNT\(\*\)/i.test(sql)) return { count: repositoryVerified ? 6 : 7 };
        if (/photo_uri/i.test(sql)) {
          return { photo_uri: repositoryVerified ? 'poop-photos/native-restored.jpg' : 'poop-photos/native-kept.jpg' };
        }
        return null;
      });
    const getAllAsync = jest.fn(async () =>
      [...RECORDS_FINAL_OBJECT_NAMES, ...RECORDS_V6_OBJECT_NAMES].map((name) => ({ name })));
    const runAsync = jest.fn(async (sql: string, ...params: (string | number | null)[]) => {
      if (/constraint-probe-invalid-mixed/i.test(sql)) {
        invalidMixedAttempted = true;
        throw new Error('invalid feeding fields');
      }
      if (/constraint-probe-bottle/i.test(sql) && !insideTransaction) {
        throw new Error('bottled breast milk probe must use the feeding repository transaction');
      }
      if (/INSERT INTO records/i.test(sql) && params[0] === 'constraint-probe-bottle') {
        bottledRow = {
          id: params[0],
          client_request_id: params[1],
          create_payload_hash: params[2],
          type: 'feeding',
          event_time_ms: params[3],
          record_date: params[4],
          sort_time_ms: params[5],
          created_at_ms: params[6],
          updated_at_ms: params[7],
          note: params[8],
          feeding_type: params[9],
          milk_amount_ml: params[10],
          breast_milk_amount_ml: params[11],
          left_duration_min: params[12],
          right_duration_min: params[13],
        };
      }
      if (/DELETE FROM records/i.test(sql) && params[0] === 'constraint-probe-bottle') bottledRow = null;
      return { changes: 1, lastInsertRowId: 0 };
    });
    const transaction = { execAsync, getFirstAsync, getAllAsync, runAsync };
    const database = {
      ...transaction,
      withExclusiveTransactionAsync: jest.fn(async (task: (value: typeof transaction) => Promise<void>) => {
        insideTransaction = true;
        try {
          await task(transaction);
        } finally {
          insideTransaction = false;
        }
      }),
      closeAsync: jest.fn(async () => undefined),
    };
    const dependencies: VerificationDependencies = {
      openDatabaseAsync: jest.fn(async (name) => {
        expect(name).toBe(VERIFICATION_DATABASE_NAME);
        return database as unknown as Awaited<ReturnType<VerificationDependencies['openDatabaseAsync']>>;
      }),
      deleteDatabaseAsync: jest.fn(async () => undefined),
      migrateDatabase: jest.fn(async (_database, options) => { userVersion = options?.targetVersion ?? 9; }),
      verifyRepositoryPath: jest.fn(async () => {
        repositoryVerified = true;
        return {
          finalRecordCount: 6,
          restoredRecordDate: '2026-07-10',
          normalWriteRecordDate: '2026-07-12',
          restoreRepositoryVerified: true as const,
          normalRepositoryWriteVerified: true as const,
          invalidSleepRejected: true as const,
          sleepingConstraintVerified: true as const,
        };
      }),
    };

    await expect(verifyCriticalConstraintsInIsolatedDatabase(dependencies)).resolves.toEqual({
      migrationVerified: true,
      reopenedPersistenceVerified: true,
      finalRecordCount: 6,
      restoredRecordDate: '2026-07-10',
      normalWriteRecordDate: '2026-07-12',
      restoreRepositoryVerified: true,
      normalRepositoryWriteVerified: true,
      invalidSleepRejected: true,
      sleepingConstraintVerified: true,
      userVersion: 9,
      recordCount: 6,
    });
    expect(dependencies.migrateDatabase).toHaveBeenCalledTimes(2);
    expect(dependencies.migrateDatabase).toHaveBeenNthCalledWith(1, database, { targetVersion: 7 });
    expect(dependencies.verifyRepositoryPath).toHaveBeenCalledWith(database);
    expect(dependencies.openDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(database.closeAsync).toHaveBeenCalledTimes(2);
    expect(invalidMixedAttempted).toBe(true);
    expect(dependencies.deleteDatabaseAsync).toHaveBeenNthCalledWith(1, VERIFICATION_DATABASE_NAME);
    expect(dependencies.deleteDatabaseAsync).toHaveBeenLastCalledWith(VERIFICATION_DATABASE_NAME);
  });
});
