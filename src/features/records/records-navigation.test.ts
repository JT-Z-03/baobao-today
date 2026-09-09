import { resolveRecordsDateIntent } from './records-navigation';

const today = '2026-09-09';

test('an ordinary tab visit has no date intent', () => {
  expect(resolveRecordsDateIntent(undefined, today)).toBeNull();
});

test.each(['2026-09-08', '2026-09-09', '2024-02-29'])('keeps a valid local calendar date %s', (date) => {
  expect(resolveRecordsDateIntent(date, today)).toBe(date);
});

test.each(['', 'invalid', '2026-02-30', '2026-9-8', '2026-09-10', ['2026-09-08']])(
  'resolves an invalid, ambiguous or future intent to today: %s', (value) => {
    expect(resolveRecordsDateIntent(value, today)).toBe(today);
  },
);
