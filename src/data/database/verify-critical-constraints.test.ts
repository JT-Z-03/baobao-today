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
    const database = {
      execAsync: jest.fn(async () => undefined),
      getFirstAsync: jest.fn(async (sql: string) => {
        if (/PRAGMA user_version/i.test(sql)) return { user_version: userVersion };
        if (/type='sleep'/i.test(sql)) return { count: 0 };
        if (/COUNT\(\*\)/i.test(sql)) return { count: repositoryVerified ? 6 : 7 };
        if (/photo_uri/i.test(sql)) {
          return { photo_uri: repositoryVerified ? 'poop-photos/native-restored.jpg' : 'poop-photos/native-kept.jpg' };
        }
        return null;
      }),
      getAllAsync: jest.fn(async () => [...RECORDS_FINAL_OBJECT_NAMES, ...RECORDS_V6_OBJECT_NAMES].map((name) => ({ name }))),
      withExclusiveTransactionAsync: jest.fn(async () => undefined),
      runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
      closeAsync: jest.fn(async () => undefined),
    };
    const dependencies: VerificationDependencies = {
      openDatabaseAsync: jest.fn(async (name) => {
        expect(name).toBe(VERIFICATION_DATABASE_NAME);
        return database as unknown as Awaited<ReturnType<VerificationDependencies['openDatabaseAsync']>>;
      }),
      deleteDatabaseAsync: jest.fn(async () => undefined),
      migrateDatabase: jest.fn(async (_database, options) => { userVersion = options?.targetVersion ?? 8; }),
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
      userVersion: 8,
      recordCount: 6,
    });
    expect(dependencies.migrateDatabase).toHaveBeenCalledTimes(2);
    expect(dependencies.migrateDatabase).toHaveBeenNthCalledWith(1, database, { targetVersion: 7 });
    expect(dependencies.verifyRepositoryPath).toHaveBeenCalledWith(database);
    expect(dependencies.openDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(database.closeAsync).toHaveBeenCalledTimes(2);
    expect(dependencies.deleteDatabaseAsync).toHaveBeenNthCalledWith(1, VERIFICATION_DATABASE_NAME);
    expect(dependencies.deleteDatabaseAsync).toHaveBeenLastCalledWith(VERIFICATION_DATABASE_NAME);
  });
});
