import { formatSleepClock, formatSleepDuration } from './sleep-format';

describe('sleep formatting', () => {
  test('formats clock and duration without converting an active interval into statistics', () => {
    expect(formatSleepClock(new Date(2026, 6, 11, 2, 5).getTime())).toBe('02:05');
    expect(formatSleepDuration(93 * 60_000)).toBe('1小时33分钟');
    expect(formatSleepDuration(2 * 60 * 60_000)).toBe('2小时');
  });
});
