import { getLocalDayBounds, shiftLocalDateKey, toLocalDateKey } from './local-date';

describe('local date rules', () => {
  test('formats a timestamp using the device local calendar date', () => {
    const localTime = new Date(2026, 6, 10, 23, 59, 59, 999);

    expect(toLocalDateKey(localTime.getTime())).toBe('2026-07-10');
  });

  test('creates a half-open natural day interval', () => {
    const bounds = getLocalDayBounds('2026-07-10');

    expect(new Date(bounds.startMs)).toEqual(new Date(2026, 6, 10, 0, 0, 0, 0));
    expect(new Date(bounds.endMs)).toEqual(new Date(2026, 6, 11, 0, 0, 0, 0));
  });

  test('moves by local calendar days across month boundaries', () => {
    expect(shiftLocalDateKey('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftLocalDateKey('2026-08-01', -1)).toBe('2026-07-31');
  });
});
