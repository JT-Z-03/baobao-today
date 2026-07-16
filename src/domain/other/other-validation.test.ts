import { deriveRecordFields } from '@/domain/records/record-derived-fields';

import {
  normalizeAndValidateOtherInput,
  OTHER_FUTURE_TOLERANCE_MS,
  OtherValidationError,
} from './other-validation';

const nowMs = new Date(2026, 6, 11, 12, 0).getTime();

describe('other record validation', () => {
  test('normalizes surrounding whitespace while preserving title body and note newlines', () => {
    expect(normalizeAndValidateOtherInput({
      eventTimeMs: nowMs,
      title: '  吃  维生素  ',
      note: '\n  第一行\n第二行  \n',
    }, nowMs)).toEqual({
      eventTimeMs: nowMs,
      title: '吃  维生素',
      note: '第一行\n第二行',
    });
  });

  test.each(['', '   ', '\n\t'])('rejects an empty normalized title: %j', (title) => {
    expect(() => normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title, note: null }, nowMs))
      .toThrow(OtherValidationError);
  });

  test('accepts exactly 30 title characters and rejects 31', () => {
    expect(normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title: '洗'.repeat(30), note: null }, nowMs).title)
      .toHaveLength(30);
    expect(() => normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title: '洗'.repeat(31), note: null }, nowMs))
      .toThrow(/30/);
  });

  test('normalizes absent notes and enforces the 200 character boundary', () => {
    expect(normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title: '洗澡', note: '   ' }, nowMs).note)
      .toBeNull();
    expect(normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title: '洗澡', note: '好'.repeat(200) }, nowMs).note)
      .toHaveLength(200);
    expect(() => normalizeAndValidateOtherInput({ eventTimeMs: nowMs, title: '洗澡', note: '好'.repeat(201) }, nowMs))
      .toThrow(/200/);
  });

  test('accepts past time and five-second tolerance but rejects later future time', () => {
    expect(normalizeAndValidateOtherInput({ eventTimeMs: nowMs - 1, title: '洗澡', note: null }, nowMs).eventTimeMs)
      .toBe(nowMs - 1);
    expect(normalizeAndValidateOtherInput({
      eventTimeMs: nowMs + OTHER_FUTURE_TOLERANCE_MS, title: '洗澡', note: null,
    }, nowMs).eventTimeMs).toBe(nowMs + OTHER_FUTURE_TOLERANCE_MS);
    expect(() => normalizeAndValidateOtherInput({
      eventTimeMs: nowMs + OTHER_FUTURE_TOLERANCE_MS + 1, title: '洗澡', note: null,
    }, nowMs)).toThrow(/当前时间/);
  });

  test('drops fields outside the typed Other contract and derives a moved local date', () => {
    const moved = new Date(2026, 6, 10, 23, 30).getTime();
    const normalized = normalizeAndValidateOtherInput({
      eventTimeMs: moved,
      title: '洗澡',
      note: null,
      feedingType: 'formula',
      photoUri: 'poop-photos/bad.jpg',
      sleepStatus: 'sleeping',
    } as never, nowMs);
    expect(normalized).toEqual({ eventTimeMs: moved, title: '洗澡', note: null });
    expect(deriveRecordFields({ type: 'other', eventTimeMs: normalized.eventTimeMs }))
      .toEqual({ recordDate: '2026-07-10', sortTimeMs: moved });
  });
});
