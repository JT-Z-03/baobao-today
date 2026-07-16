import { getLocalDayBounds, type LocalDateKey, parseLocalDateKey, shiftLocalDateKey } from '@/domain/date/local-date';

export type ExportScope =
  | { kind: 'all' }
  | { kind: 'date-range'; startDate: string; endDate: string };

export type ResolvedExportRange =
  | { kind: 'all' }
  | {
      kind: 'date-range';
      startDate: LocalDateKey;
      endDate: LocalDateKey;
      startMs: number;
      endExclusiveMs: number;
    };

export class ExportRangeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportRangeValidationError';
  }
}

function parseDate(value: string, fieldName: string) {
  if (!value) throw new ExportRangeValidationError(`请选择${fieldName}`);
  try {
    parseLocalDateKey(value);
    return value as LocalDateKey;
  } catch {
    throw new ExportRangeValidationError(`${fieldName}格式无效`);
  }
}

export function resolveExportRange(scope: ExportScope, today: LocalDateKey): ResolvedExportRange {
  if (scope.kind === 'all') return scope;
  const startDate = parseDate(scope.startDate, '开始日期');
  const endDate = parseDate(scope.endDate, '结束日期');
  if (startDate > endDate) throw new ExportRangeValidationError('开始日期不能晚于结束日期');
  if (endDate > today) throw new ExportRangeValidationError('结束日期不能晚于今天');
  return {
    kind: 'date-range',
    startDate,
    endDate,
    startMs: getLocalDayBounds(startDate).startMs,
    endExclusiveMs: getLocalDayBounds(shiftLocalDateKey(endDate, 1)).startMs,
  };
}

type RangeSourceRecord =
  | { type: 'feeding' | 'poop' | 'pee' | 'other'; eventTimeMs: number }
  | {
      type: 'sleep';
      eventTimeMs: number;
      sleepStartMs: number;
      sleepEndMs: number | null;
    };

export function sourceRecordOverlapsRange(
  record: RangeSourceRecord,
  range: { startMs: number; endExclusiveMs: number },
  snapshotTimeMs: number,
) {
  if (record.type !== 'sleep') {
    return record.eventTimeMs >= range.startMs && record.eventTimeMs < range.endExclusiveMs;
  }
  const intervalEnd = record.sleepEndMs ?? snapshotTimeMs;
  return record.sleepStartMs < range.endExclusiveMs && intervalEnd > range.startMs;
}
