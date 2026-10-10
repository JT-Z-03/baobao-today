/** @jest-environment node */
// @ts-expect-error Node 24 supplies node:sqlite without app Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from './migrations';
import { ACCEPTANCE_SLEEP_ID, runNativeDatabaseAcceptanceAction } from './native-acceptance';

test('native sleeping seed obeys current schema and can be reseeded and cleaned up', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
    const database = {
      getFirstAsync: async (sql: string, ...params: (string | number | null)[]) => sqlite.prepare(sql).get(...params),
      runAsync: async (sql: string, ...params: (string | number | null)[]) => sqlite.prepare(sql).run(...params),
    };
    const nowMs = new Date(2026, 9, 4, 10).getTime();
    await runNativeDatabaseAcceptanceAction(database, 'seed-sleeping', nowMs);
    expect(sqlite.prepare('SELECT event_time_ms, sleep_start_ms, sleep_status FROM records WHERE id = ?').get(ACCEPTANCE_SLEEP_ID))
      .toEqual({ event_time_ms: nowMs, sleep_start_ms: nowMs, sleep_status: 'sleeping' });
    await runNativeDatabaseAcceptanceAction(database, 'seed-sleeping', nowMs + 60_000);
    expect(await runNativeDatabaseAcceptanceAction(database, 'inspect', nowMs)).toMatchObject({ sleepingCount: 1 });
    await runNativeDatabaseAcceptanceAction(database, 'cleanup-sleeping', nowMs);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 0 });
  } finally {
    sqlite.close();
  }
});
