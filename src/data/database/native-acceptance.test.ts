import {
  ACCEPTANCE_SLEEP_ID,
  runNativeDatabaseAcceptanceAction,
  type NativeAcceptanceDatabase,
} from './native-acceptance';

describe('native database acceptance actions', () => {
  test('does nothing when no acceptance action is requested', async () => {
    const database: NativeAcceptanceDatabase = {
      getFirstAsync: jest.fn(),
      runAsync: jest.fn(),
    };

    await expect(runNativeDatabaseAcceptanceAction(database, undefined, 100)).resolves.toEqual({
      action: 'none',
    });
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  test('seeds one valid business sleeping record with no probe identifiers', async () => {
    const database: NativeAcceptanceDatabase = {
      getFirstAsync: jest.fn(),
      runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
    };

    const result = await runNativeDatabaseAcceptanceAction(database, 'seed-sleeping', 100);

    expect(result).toEqual({ action: 'seed-sleeping', recordId: ACCEPTANCE_SLEEP_ID });
    expect(database.runAsync).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((database.runAsync as jest.Mock).mock.calls)).not.toMatch(/probe|verification/i);
  });

  test('reports existing sleeping and probe counts without writing', async () => {
    const database: NativeAcceptanceDatabase = {
      getFirstAsync: jest.fn(async () => ({
        sleeping_count: 1,
        acceptance_sleeping_count: 1,
        probe_count: 0,
      })),
      runAsync: jest.fn(),
    };

    await expect(runNativeDatabaseAcceptanceAction(database, 'inspect', 100)).resolves.toEqual({
      action: 'inspect',
      sleepingCount: 1,
      acceptanceSleepingCount: 1,
      probeCount: 0,
    });
    expect(database.runAsync).not.toHaveBeenCalled();
  });
});
