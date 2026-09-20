export type BreastSide = 'left' | 'right';
export type BreastfeedingTimer = {
  startedAtMs: number; segmentStartedAtMs: number | null; side: BreastSide | null;
  leftMs: number; rightMs: number; lastActionAtMs: number;
  finished: boolean; issue: 'clock' | 'limit' | null;
};
export type TimerAction = { type: 'switch'; side: BreastSide } | { type: 'pause' | 'finish' | 'clock' };
const SIDE_LIMIT_MS = 180 * 60_000;

export function createTimer(side: BreastSide, nowMs: number): BreastfeedingTimer {
  return { startedAtMs: nowMs, segmentStartedAtMs: nowMs, side, leftMs: 0, rightMs: 0,
    lastActionAtMs: nowMs, finished: false, issue: null };
}

export function timerTotals(timer: BreastfeedingTimer, nowMs: number) {
  const elapsed = timer.segmentStartedAtMs === null ? 0 : Math.max(0, nowMs - timer.segmentStartedAtMs);
  return { leftMs: timer.leftMs + (timer.side === 'left' ? elapsed : 0),
    rightMs: timer.rightMs + (timer.side === 'right' ? elapsed : 0) };
}

export function transitionTimer(timer: BreastfeedingTimer, action: TimerAction, nowMs: number): BreastfeedingTimer {
  if (timer.finished) return timer;
  const reversed = nowMs < timer.lastActionAtMs || action.type === 'clock';
  const totals = reversed ? { leftMs: timer.leftMs, rightMs: timer.rightMs } : timerTotals(timer, nowMs);
  const issue = reversed ? 'clock' : Math.max(totals.leftMs, totals.rightMs) > SIDE_LIMIT_MS ? 'limit' : timer.issue;
  const side = !issue && action.type === 'switch' ? action.side : null;
  return { ...timer, ...totals, side, segmentStartedAtMs: side ? nowMs : null,
    lastActionAtMs: nowMs, finished: action.type === 'finish', issue };
}

export function timerMinutes(totals: { leftMs: number; rightMs: number }) {
  const { leftMs, rightMs } = totals;
  if (leftMs < 0 || rightMs < 0 || Math.max(leftMs, rightMs) > SIDE_LIMIT_MS) {
    throw new Error('计时时长超出范围，请手动核对左右时长');
  }
  const sum = leftMs + rightMs;
  if (!Number.isFinite(sum) || sum <= 0) throw new Error('请先记录亲喂时长');
  const target = Math.max(1, Math.round(sum / 60_000));
  let left = Math.floor(leftMs / 60_000);
  let right = Math.floor(rightMs / 60_000);
  let remaining = target - left - right;
  const order = leftMs % 60_000 >= rightMs % 60_000 ? ['left', 'right'] : ['right', 'left'];
  for (const side of order) {
    if (remaining-- <= 0) break;
    if (side === 'left') left++; else right++;
  }
  return { left, right, short: sum < 60_000 };
}

export function formatTimerDuration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
