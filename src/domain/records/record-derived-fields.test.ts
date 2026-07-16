import { deriveRecordFields } from './record-derived-fields';

describe('record derived fields', () => {
  test('derives a regular record date and sort time from event time', () => {
    const eventTimeMs = new Date(2026, 6, 10, 4, 25).getTime();

    expect(deriveRecordFields({ type: 'feeding', eventTimeMs })).toEqual({
      recordDate: '2026-07-10',
      sortTimeMs: eventTimeMs,
    });
  });

  test('derives sleep ownership and sorting only from sleep start time', () => {
    const sleepStartMs = new Date(2026, 6, 10, 23, 0).getTime();
    const sleepEndMs = new Date(2026, 6, 11, 2, 0).getTime();

    expect(deriveRecordFields({ type: 'sleep', sleepStartMs, sleepEndMs })).toEqual({
      recordDate: '2026-07-10',
      sortTimeMs: sleepStartMs,
    });
  });
});
