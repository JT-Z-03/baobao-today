import { formatRecordTime, recordTimeShortcut } from './record-time-shortcuts';

test('a shortcut uses the supplied click instant and crosses midnight correctly', () => {
  const click = new Date(2026, 8, 20, 0, 5).getTime();
  expect(formatRecordTime(recordTimeShortcut(click, 10), click)).toBe('昨天 23:55');
  expect(recordTimeShortcut(click + 300_000, 10)).toBe(click - 300_000);
  expect(recordTimeShortcut(click, 0)).toBe(click);
});
test('older dates include the year across a year boundary', () => {
  expect(formatRecordTime(new Date(2025, 11, 30, 22, 5).getTime(), new Date(2026, 0, 1).getTime()))
    .toBe('2025年12月30日 22:05');
});
