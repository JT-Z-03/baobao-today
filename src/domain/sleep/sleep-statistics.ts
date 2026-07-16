import { getLocalDayBounds } from '@/domain/date/local-date';

export type SleepInterval =
  | { startMs: number; endMs: number; status: 'completed' }
  | { startMs: number; endMs: null; status: 'sleeping' };

export function calculateCompletedSleepOverlapMs(sleep: SleepInterval, dateKey: string) {
  if (sleep.status !== 'completed') {
    return 0;
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = getLocalDayBounds(dateKey);
  return Math.max(0, Math.min(sleep.endMs, dayEndMs) - Math.max(sleep.startMs, dayStartMs));
}

export function sumCompletedSleepOverlapMs(
  sleeps: readonly SleepInterval[],
  dateKey: string,
) {
  return sleeps.reduce(
    (total, sleep) => total + calculateCompletedSleepOverlapMs(sleep, dateKey),
    0,
  );
}
