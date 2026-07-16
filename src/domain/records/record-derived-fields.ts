import { toLocalDateKey } from '@/domain/date/local-date';

type RegularRecordInput = {
  type: 'feeding' | 'poop' | 'pee' | 'other';
  eventTimeMs: number;
};

type SleepRecordInput = {
  type: 'sleep';
  sleepStartMs: number;
  sleepEndMs: number | null;
};

export type RecordTimeInput = RegularRecordInput | SleepRecordInput;

export function deriveRecordFields(input: RecordTimeInput) {
  const primaryTimeMs = input.type === 'sleep' ? input.sleepStartMs : input.eventTimeMs;
  return {
    recordDate: toLocalDateKey(primaryTimeMs),
    sortTimeMs: primaryTimeMs,
  };
}
