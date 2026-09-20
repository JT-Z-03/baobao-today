import { createTimer, transitionTimer, timerTotals, timerMinutes } from './breastfeeding-timer';

test('switching closes the old side at the same instant and pauses exclude elapsed time', () => {
  let timer = createTimer('left', 1_000);
  timer = transitionTimer(timer, { type: 'switch', side: 'right' }, 61_000);
  timer = transitionTimer(timer, { type: 'pause' }, 91_000);
  expect(timerTotals(timer, 200_000)).toEqual({ leftMs: 60_000, rightMs: 30_000 });
  timer = transitionTimer(timer, { type: 'switch', side: 'right' }, 201_000);
  timer = transitionTimer(timer, { type: 'finish' }, 231_000);
  expect(timerTotals(timer, 900_000)).toEqual({ leftMs: 60_000, rightMs: 60_000 });
  expect(timer.finished).toBe(true);
});

test('a duplicate side action does not lose or duplicate elapsed time', () => {
  const timer = createTimer('left', 1_000);
  const next = transitionTimer(timer, { type: 'switch', side: 'left' }, 2_000);
  expect(timerTotals(next, 61_000).leftMs).toBe(60_000);
});

test('a restarted session derives elapsed time from persisted timestamps', () => {
  const restored = JSON.parse(JSON.stringify(createTimer('right', 1_000)));
  expect(timerTotals(restored, 121_000).rightMs).toBe(120_000);
});

test('clock reversal pauses at the last confirmed total instead of subtracting time', () => {
  const timer = transitionTimer(createTimer('left', 2_000), { type: 'pause' }, 1_000);
  expect(timer.issue).toBe('clock');
  expect(timer.side).toBeNull();
  expect(timerTotals(timer, 50_000).leftMs).toBe(0);
});

test('rounds the combined duration then allocates remaining minutes', () => {
  expect(timerMinutes({ leftMs: 640_000, rightMs: 320_000 })).toEqual({ left: 11, right: 5, short: false });
  expect(timerMinutes({ leftMs: 10_000, rightMs: 20_000 })).toEqual({ left: 0, right: 1, short: true });
  expect(() => timerMinutes({ leftMs: 0, rightMs: 0 })).toThrow();
  expect(() => timerMinutes({ leftMs: 180 * 60_000 + 1, rightMs: 0 })).toThrow();
});
