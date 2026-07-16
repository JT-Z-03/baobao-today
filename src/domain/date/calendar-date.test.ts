import { differenceInCalendarDates } from './calendar-date';

describe('Gregorian calendar date difference', () => {
  test('counts consecutive dates without using elapsed milliseconds', () => {
    expect(differenceInCalendarDates('2026-07-10', '2026-07-11')).toBe(1);
  });

  test('works across month and year boundaries', () => {
    expect(differenceInCalendarDates('2026-01-31', '2026-02-01')).toBe(1);
    expect(differenceInCalendarDates('2025-12-31', '2026-01-01')).toBe(1);
  });

  test('treats daylight-saving transition dates as ordinary adjacent calendar dates', () => {
    expect(differenceInCalendarDates('2026-03-08', '2026-03-09')).toBe(1);
    expect(differenceInCalendarDates('2026-11-01', '2026-11-02')).toBe(1);
  });
});
