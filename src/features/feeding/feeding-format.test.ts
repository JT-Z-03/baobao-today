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
  breastMilkAmountMl: null,
  leftDurationMin: null,
  rightDurationMin: null,
  note: null,
};

describe('feeding display formatting', () => {
  test('formats formula and direct breast details', () => {
    expect(formatFeedingDetails(base)).toBe('奶粉 90ml');
    expect(
      formatFeedingDetails({
        ...base,
        feedingType: 'breast',
        milkAmountMl: null,
        leftDurationMin: 12,
        rightDurationMin: 8,
      }),
    ).toBe('亲喂母乳 左12分钟 / 右8分钟');
  });

  test('formats bottled breast milk details', () => {
    expect(
      formatFeedingDetails({
        ...base,
        feedingType: 'bottle_breast',
        milkAmountMl: null,
        breastMilkAmountMl: 120,
      }),
    ).toBe('瓶喂母乳 120ml');
  });

  test('formats mixed details in breast, bottled breast, formula order', () => {
    expect(
      formatFeedingDetails({
        ...base,
        feedingType: 'mixed',
        milkAmountMl: 40,
        breastMilkAmountMl: 80,
        leftDurationMin: 10,
        rightDurationMin: 5,
      }),
    ).toBe('混合 亲喂左10分钟 / 右5分钟 · 瓶喂母乳80ml · 奶粉40ml');
  });

  test('formats elapsed time without querying the database', () => {
    const nowMs = base.eventTimeMs + 102 * 60_000;

    expect(formatRelativePastTime(base.eventTimeMs, nowMs)).toBe('距现在 1小时42分钟');
    expect(formatRelativePastTime(nowMs - 30_000, nowMs)).toBe('刚刚');
  });
});
