import type { FeedingRecord } from '@/domain/feeding/feeding';

import { formatFeedingDetails, formatRelativePastTime } from './feeding-format';

const base: FeedingRecord = {
  id: 'feeding-1',
  type: 'feeding',
  clientRequestId: 'request-1',
  createPayloadHash: 'a'.repeat(64),
  eventTimeMs: new Date(2026, 6, 11, 2, 35).getTime(),
  recordDate: '2026-07-11',
  sortTimeMs: new Date(2026, 6, 11, 2, 35).getTime(),
  createdAtMs: 1,
  updatedAtMs: 1,
  feedingType: 'formula',
  milkAmountMl: 90,
  leftDurationMin: null,
  rightDurationMin: null,
  note: null,
};

describe('feeding display formatting', () => {
  test('formats formula, breast, and mixed details', () => {
    expect(formatFeedingDetails(base)).toBe('奶粉 90ml');
    expect(
      formatFeedingDetails({
        ...base,
        feedingType: 'breast',
        milkAmountMl: null,
        leftDurationMin: 12,
        rightDurationMin: 8,
      }),
    ).toBe('母乳 左12分钟 / 右8分钟');
    expect(
      formatFeedingDetails({
        ...base,
        feedingType: 'mixed',
        milkAmountMl: 60,
        leftDurationMin: 10,
        rightDurationMin: 0,
      }),
    ).toBe('混合 左10分钟 / 奶粉60ml');
  });

  test('formats elapsed time without querying the database', () => {
    const nowMs = base.eventTimeMs + 102 * 60_000;

    expect(formatRelativePastTime(base.eventTimeMs, nowMs)).toBe('距现在 1小时42分钟');
    expect(formatRelativePastTime(nowMs - 30_000, nowMs)).toBe('刚刚');
  });
});
