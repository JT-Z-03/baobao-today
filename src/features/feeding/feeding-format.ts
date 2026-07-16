import type { FeedingRecord } from '@/domain/feeding/feeding';

function padTwoDigits(value: number) {
  return value.toString().padStart(2, '0');
}

export function formatEventTime(eventTimeMs: number) {
  const date = new Date(eventTimeMs);
  return `${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`;
}

export function formatFeedingDetails(record: FeedingRecord) {
  if (record.feedingType === 'formula') return `奶粉 ${record.milkAmountMl}ml`;

  const breastParts: string[] = [];
  if ((record.leftDurationMin ?? 0) > 0) breastParts.push(`左${record.leftDurationMin}分钟`);
  if ((record.rightDurationMin ?? 0) > 0) breastParts.push(`右${record.rightDurationMin}分钟`);

  if (record.feedingType === 'breast') return `母乳 ${breastParts.join(' / ')}`;
  return `混合 ${[...breastParts, `奶粉${record.milkAmountMl}ml`].join(' / ')}`;
}

export function formatRelativePastTime(eventTimeMs: number, nowMs: number) {
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - eventTimeMs) / 60_000));
  if (elapsedMinutes < 1) return '刚刚';
  if (elapsedMinutes < 60) return `距现在 ${elapsedMinutes}分钟`;

  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours < 24) return `距现在 ${hours}小时${minutes ? `${minutes}分钟` : ''}`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `距现在 ${days}天${remainingHours ? `${remainingHours}小时` : ''}`;
}
