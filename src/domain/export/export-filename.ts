import type { ResolvedExportRange } from '@/domain/export/export-range';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function compactDate(value: string) {
  return value.replace(/-/g, '');
}

function timestamp(nowMs: number) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function buildExportFilename(range: ResolvedExportRange, nowMs: number) {
  const stamp = timestamp(nowMs);
  if (range.kind === 'date-range') {
    return `baobao-today-records-${compactDate(range.startDate)}-to-${compactDate(range.endDate)}-${stamp}.csv`;
  }
  return `baobao-today-records-${stamp}.csv`;
}
