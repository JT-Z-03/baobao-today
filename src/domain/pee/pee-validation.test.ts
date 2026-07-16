import { deriveRecordFields } from '@/domain/records/record-derived-fields';

import type { PeeCoreInput } from './pee';
import {
  normalizeAndValidatePeeInput,
  PEE_FUTURE_TOLERANCE_MS,
  PeeValidationError,
} from './pee-validation';

const nowMs = new Date(2026, 6, 11, 12, 0).getTime();

function input(overrides: Partial<PeeCoreInput> = {}): PeeCoreInput {
  return { eventTimeMs: nowMs, amount: null, color: null, note: null, ...overrides };
}

describe('pee validation', () => {
  test('accepts a time-only record with empty optional values', () => {
    expect(normalizeAndValidatePeeInput(input(), nowMs)).toEqual(input());
  });

  test.each(['small', 'medium', 'large'] as const)('accepts amount %s', (amount) => {
    expect(normalizeAndValidatePeeInput(input({ amount }), nowMs).amount).toBe(amount);
  });

  test.each(['clear', 'light_yellow', 'yellow', 'dark_yellow'] as const)('accepts color %s', (color) => {
    expect(normalizeAndValidatePeeInput(input({ color }), nowMs).color).toBe(color);
  });

  test('rejects invalid amount and color enum values', () => {
    expect(() => normalizeAndValidatePeeInput(input({ amount: 'huge' as never }), nowMs))
      .toThrow(PeeValidationError);
    expect(() => normalizeAndValidatePeeInput(input({ color: 'red' as never }), nowMs))
      .toThrow(PeeValidationError);
  });

  test('allows an empty note and preserves internal spaces and newlines while trimming edges', () => {
    expect(normalizeAndValidatePeeInput(input({ note: '  first  line\nsecond line  ' }), nowMs).note)
      .toBe('first  line\nsecond line');
    expect(normalizeAndValidatePeeInput(input({ note: '  ' }), nowMs).note).toBeNull();
  });

  test('accepts exactly 200 note characters and rejects 201', () => {
    expect(normalizeAndValidatePeeInput(input({ note: 'a'.repeat(200) }), nowMs).note).toHaveLength(200);
    expect(() => normalizeAndValidatePeeInput(input({ note: 'a'.repeat(201) }), nowMs))
      .toThrow('备注不能超过200个字符');
  });

  test('accepts the tolerance boundary and rejects a later future time', () => {
    expect(normalizeAndValidatePeeInput(input({ eventTimeMs: nowMs + PEE_FUTURE_TOLERANCE_MS }), nowMs).eventTimeMs)
      .toBe(nowMs + PEE_FUTURE_TOLERANCE_MS);
    expect(() => normalizeAndValidatePeeInput(input({ eventTimeMs: nowMs + PEE_FUTURE_TOLERANCE_MS + 1 }), nowMs))
      .toThrow('记录时间不能晚于当前时间');
  });

  test('rejects non-integer event time', () => {
    expect(() => normalizeAndValidatePeeInput(input({ eventTimeMs: nowMs + 0.5 }), nowMs))
      .toThrow('请选择有效的记录时间');
  });

  test('derives the destination date after a cross-day edit', () => {
    const movedMs = new Date(2026, 6, 10, 23, 59).getTime();
    const normalized = normalizeAndValidatePeeInput(input({ eventTimeMs: movedMs }), nowMs);
    expect(deriveRecordFields({ type: 'pee', eventTimeMs: normalized.eventTimeMs })).toEqual({
      recordDate: '2026-07-10',
      sortTimeMs: movedMs,
    });
  });

  test('normalization returns only pee fields even when an untyped caller adds unrelated data', () => {
    const normalized = normalizeAndValidatePeeInput({
      ...input(),
      milkAmountMl: 90,
      poopColor: 'yellow',
    } as PeeCoreInput, nowMs);
    expect(normalized).toEqual(input());
  });
});
