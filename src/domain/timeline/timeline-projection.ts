import { toLocalDateKey } from '@/domain/date/local-date';

export type SleepTimelineSource =
  | { id: string; startMs: number; endMs: number; status: 'completed' }
  | { id: string; startMs: number; endMs: null; status: 'sleeping' };

export type SleepTimelineEvent = {
  recordId: string;
  kind: 'sleep-start' | 'sleep-end';
  occurrenceTimeMs: number;
};

type OccurrenceSortable = {
  sortTimeMs: number;
  createdAtMs: number;
};

export function sortRecordsByOccurrence<T extends OccurrenceSortable>(records: readonly T[]) {
  return [...records].sort(
    (left, right) => right.sortTimeMs - left.sortTimeMs || right.createdAtMs - left.createdAtMs,
  );
}

export function projectSleepTimeline(record: SleepTimelineSource, dateKey: string) {
  const events: SleepTimelineEvent[] = [];
  if (toLocalDateKey(record.startMs) === dateKey) {
    events.push({ recordId: record.id, kind: 'sleep-start', occurrenceTimeMs: record.startMs });
  }
  if (record.status === 'completed' && toLocalDateKey(record.endMs) === dateKey) {
    events.push({ recordId: record.id, kind: 'sleep-end', occurrenceTimeMs: record.endMs });
  }
  return events.sort((left, right) => right.occurrenceTimeMs - left.occurrenceTimeMs);
}
