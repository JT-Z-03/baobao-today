import { projectSleepTimeline, sortRecordsByOccurrence } from './timeline-projection';

describe('sleep timeline projection', () => {
  test('projects cross-day start and end events onto their own local dates', () => {
    const record = {
      id: 'sleep-record-1',
      startMs: new Date(2026, 6, 10, 23, 0).getTime(),
      endMs: new Date(2026, 6, 11, 2, 0).getTime(),
      status: 'completed' as const,
    };

    expect(projectSleepTimeline(record, '2026-07-10')).toEqual([
      { recordId: 'sleep-record-1', kind: 'sleep-start', occurrenceTimeMs: record.startMs },
    ]);
    expect(projectSleepTimeline(record, '2026-07-11')).toEqual([
      { recordId: 'sleep-record-1', kind: 'sleep-end', occurrenceTimeMs: record.endMs },
    ]);
  });

  test('only projects the start event for an in-progress sleep', () => {
    const startMs = new Date(2026, 6, 10, 21, 0).getTime();

    expect(
      projectSleepTimeline(
        { id: 'sleep-record-2', startMs, endMs: null, status: 'sleeping' },
        '2026-07-10',
      ),
    ).toEqual([{ recordId: 'sleep-record-2', kind: 'sleep-start', occurrenceTimeMs: startMs }]);
  });

  test('orders same-day occurrences independently while retaining one source id', () => {
    const record = {
      id: 'sleep-record-3',
      startMs: new Date(2026, 6, 11, 1, 0).getTime(),
      endMs: new Date(2026, 6, 11, 3, 0).getTime(),
      status: 'completed' as const,
    };
    expect(projectSleepTimeline(record, '2026-07-11')).toEqual([
      { recordId: record.id, kind: 'sleep-end', occurrenceTimeMs: record.endMs },
      { recordId: record.id, kind: 'sleep-start', occurrenceTimeMs: record.startMs },
    ]);
  });

  test('sorts source records including other by occurrence time without changing their types', () => {
    const records = [
      { id: 'feeding', type: 'feeding', sortTimeMs: 10, createdAtMs: 10 },
      { id: 'pee', type: 'pee', sortTimeMs: 30, createdAtMs: 30 },
      { id: 'poop', type: 'poop', sortTimeMs: 20, createdAtMs: 20 },
      { id: 'other', type: 'other', sortTimeMs: 40, createdAtMs: 40 },
    ] as const;
    expect(sortRecordsByOccurrence(records).map((record) => record.type))
      .toEqual(['other', 'pee', 'poop', 'feeding']);
  });
});
