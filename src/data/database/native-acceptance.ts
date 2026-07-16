import { deriveRecordFields } from '@/domain/records/record-derived-fields';

export const ACCEPTANCE_SLEEP_ID = 'acceptance-business-sleeping-record';

type SQLiteValue = string | number | null;
type NativeAcceptanceAction = 'seed-sleeping' | 'inspect' | 'cleanup-sleeping';

type AcceptanceCountsRow = {
  sleeping_count: number;
  acceptance_sleeping_count: number;
  probe_count: number;
};

export interface NativeAcceptanceDatabase {
  getFirstAsync(sql: string, ...params: SQLiteValue[]): Promise<AcceptanceCountsRow | null>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export function parseNativeAcceptanceAction(value: string | undefined): NativeAcceptanceAction | undefined {
  if (value === 'seed-sleeping' || value === 'inspect' || value === 'cleanup-sleeping') return value;
  return undefined;
}

export async function runNativeDatabaseAcceptanceAction(
  database: NativeAcceptanceDatabase,
  action: NativeAcceptanceAction | undefined,
  nowMs: number,
) {
  if (!action) return { action: 'none' as const };

  if (action === 'seed-sleeping') {
    const derived = deriveRecordFields({ type: 'sleep', sleepStartMs: nowMs, sleepEndMs: null });
    await database.runAsync('DELETE FROM records WHERE id = ?', ACCEPTANCE_SLEEP_ID);
    await database.runAsync(
      `
        INSERT INTO records (
          id, client_request_id, create_payload_hash, type,
          event_time_ms, record_date, sort_time_ms,
          created_at_ms, updated_at_ms,
          sleep_start_ms, sleep_end_ms, sleep_status
        ) VALUES (?, ?, ?, 'sleep', NULL, ?, ?, ?, ?, ?, NULL, 'sleeping')
      `,
      ACCEPTANCE_SLEEP_ID,
      'acceptance-business-sleeping-request',
      'a'.repeat(64),
      derived.recordDate,
      derived.sortTimeMs,
      nowMs,
      nowMs,
      nowMs,
    );
    return { action, recordId: ACCEPTANCE_SLEEP_ID };
  }

  if (action === 'cleanup-sleeping') {
    await database.runAsync('DELETE FROM records WHERE id = ?', ACCEPTANCE_SLEEP_ID);
    return { action, recordId: ACCEPTANCE_SLEEP_ID };
  }

  const counts = await database.getFirstAsync(
    `
      SELECT
        SUM(CASE WHEN type = 'sleep' AND sleep_status = 'sleeping' THEN 1 ELSE 0 END) AS sleeping_count,
        SUM(CASE WHEN id = ? THEN 1 ELSE 0 END) AS acceptance_sleeping_count,
        SUM(CASE WHEN id LIKE 'constraint-probe-%' OR id LIKE 'verification-%' THEN 1 ELSE 0 END) AS probe_count
      FROM records
    `,
    ACCEPTANCE_SLEEP_ID,
  );
  return {
    action,
    sleepingCount: counts?.sleeping_count ?? 0,
    acceptanceSleepingCount: counts?.acceptance_sleeping_count ?? 0,
    probeCount: counts?.probe_count ?? 0,
  };
}
