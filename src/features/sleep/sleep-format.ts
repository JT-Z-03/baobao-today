import type { SleepRecord } from '@/domain/sleep/sleep';

export function formatSleepClock(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function formatSleepDuration(durationMs: number) {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}分钟`;
  if (!minutes) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

export function formatSleepRecordDuration(record: SleepRecord, nowMs: number) {
  return formatSleepDuration((record.endMs ?? nowMs) - record.startMs);
}
