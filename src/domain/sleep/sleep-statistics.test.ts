import { calculateCompletedSleepOverlapMs, sumCompletedSleepOverlapMs } from './sleep-statistics';

describe('daily sleep statistics', () => {
  test('returns zero for no sleep or an interval outside the selected day', () => {
    expect(sumCompletedSleepOverlapMs([], '2026-07-11')).toBe(0);
    expect(calculateCompletedSleepOverlapMs({
      startMs: new Date(2026, 6, 9, 1, 0).getTime(),
      endMs: new Date(2026, 6, 9, 2, 0).getTime(),
      status: 'completed',
    }, '2026-07-11')).toBe(0);
  });

  test('splits a completed cross-day sleep by natural-day overlap', () => {
    const sleep = {
      startMs: new Date(2026, 6, 10, 23, 0).getTime(),
      endMs: new Date(2026, 6, 11, 2, 0).getTime(),
      status: 'completed' as const,
    };

    expect(calculateCompletedSleepOverlapMs(sleep, '2026-07-10')).toBe(60 * 60 * 1000);
    expect(calculateCompletedSleepOverlapMs(sleep, '2026-07-11')).toBe(2 * 60 * 60 * 1000);
  });

  test('does not count an in-progress sleep', () => {
    expect(
      calculateCompletedSleepOverlapMs(
        {
          startMs: new Date(2026, 6, 10, 23, 0).getTime(),
          endMs: null,
          status: 'sleeping',
        },
        '2026-07-10',
      ),
    ).toBe(0);
  });

  test('sums completed overlap while excluding an active sleep', () => {
    expect(sumCompletedSleepOverlapMs([
      {
        startMs: new Date(2026, 6, 11, 0, 0).getTime(),
        endMs: new Date(2026, 6, 11, 1, 0).getTime(),
        status: 'completed' as const,
      },
      {
        startMs: new Date(2026, 6, 11, 1, 0).getTime(),
        endMs: null,
        status: 'sleeping' as const,
      },
    ], '2026-07-11')).toBe(60 * 60 * 1_000);
  });

  test('uses half-open midnight boundaries without double counting', () => {
    const midnight = new Date(2026, 6, 11, 0, 0).getTime();
    const sleep = { startMs: midnight - 60 * 60_000, endMs: midnight, status: 'completed' as const };
    expect(calculateCompletedSleepOverlapMs(sleep, '2026-07-10')).toBe(60 * 60_000);
    expect(calculateCompletedSleepOverlapMs(sleep, '2026-07-11')).toBe(0);
  });

  test('splits a multi-day interval whose daily parts sum to the full duration', () => {
    const sleep = {
      startMs: new Date(2026, 6, 9, 12, 0).getTime(),
      endMs: new Date(2026, 6, 12, 12, 0).getTime(),
      status: 'completed' as const,
    };
    const total = ['2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']
      .reduce((sum, date) => sum + calculateCompletedSleepOverlapMs(sleep, date), 0);
    expect(total).toBe(sleep.endMs - sleep.startMs);
  });
});
