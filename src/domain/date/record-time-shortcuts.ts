import { shiftLocalDateKey, toLocalDateKey } from './local-date';

export function recordTimeShortcut(nowMs: number, minutes: 0 | 10 | 30) {
  return nowMs - minutes * 60_000;
}
export function formatRecordTime(valueMs: number, nowMs: number) {
  const value = new Date(valueMs); const now = new Date(nowMs);
  const day = toLocalDateKey(valueMs); const today = toLocalDateKey(nowMs);
  const label = day === today ? '今天' : day === shiftLocalDateKey(today, -1) ? '昨天'
    : `${value.getFullYear() !== now.getFullYear() ? `${value.getFullYear()}年` : ''}${value.getMonth() + 1}月${value.getDate()}日`;
  return `${label} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}
