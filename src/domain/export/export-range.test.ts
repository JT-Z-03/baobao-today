import {
  ExportRangeValidationError,
  resolveExportRange,
  sourceRecordOverlapsRange,
} from './export-range';

const localMs = (year: number, month: number, day: number, hour = 0) =>
  new Date(year, month - 1, day, hour).getTime();

describe('CSV export date range', () => {
  test('resolves an inclusive local date selection to a half-open interval', () => {
    expect(resolveExportRange(
      { kind: 'date-range', startDate: '2026-07-10', endDate: '2026-07-11' },
      '2026-07-11',
    )).toEqual({
      kind: 'date-range',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      startMs: localMs(2026, 7, 10),
      endExclusiveMs: localMs(2026, 7, 12),
    });
  });

  test('rejects an inverted range and future end date', () => {
    expect(() => resolveExportRange(
      { kind: 'date-range', startDate: '2026-07-11', endDate: '2026-07-10' },
      '2026-07-11',
    )).toThrow(ExportRangeValidationError);
    expect(() => resolveExportRange(
      { kind: 'date-range', startDate: '2026-07-11', endDate: '2026-07-12' },
      '2026-07-11',
    )).toThrow('结束日期不能晚于今天');
  });

  test('uses event time for ordinary records with an exclusive end boundary', () => {
    const range = {
      startMs: localMs(2026, 7, 10),
      endExclusiveMs: localMs(2026, 7, 11),
    };
    expect(sourceRecordOverlapsRange({ type: 'feeding', eventTimeMs: range.startMs }, range, range.endExclusiveMs)).toBe(true);
    expect(sourceRecordOverlapsRange({ type: 'poop', eventTimeMs: range.endExclusiveMs }, range, range.endExclusiveMs)).toBe(false);
  });

  test('includes one completed sleep source whenever its interval overlaps', () => {
    const range = {
      startMs: localMs(2026, 7, 11),
      endExclusiveMs: localMs(2026, 7, 12),
    };
    expect(sourceRecordOverlapsRange({
      type: 'sleep',
      eventTimeMs: localMs(2026, 7, 10, 23),
      sleepStartMs: localMs(2026, 7, 10, 23),
      sleepEndMs: localMs(2026, 7, 11, 2),
    }, range, localMs(2026, 7, 11, 12))).toBe(true);
    expect(sourceRecordOverlapsRange({
      type: 'sleep',
      eventTimeMs: localMs(2026, 7, 9, 23),
      sleepStartMs: localMs(2026, 7, 9, 23),
      sleepEndMs: localMs(2026, 7, 10, 2),
    }, range, localMs(2026, 7, 11, 12))).toBe(false);
  });

  test('uses snapshot time as the open end only for filtering an active sleep', () => {
    const range = {
      startMs: localMs(2026, 7, 11),
      endExclusiveMs: localMs(2026, 7, 12),
    };
    expect(sourceRecordOverlapsRange({
      type: 'sleep',
      eventTimeMs: localMs(2026, 7, 10, 23),
      sleepStartMs: localMs(2026, 7, 10, 23),
      sleepEndMs: null,
    }, range, localMs(2026, 7, 11, 1))).toBe(true);
  });
});
