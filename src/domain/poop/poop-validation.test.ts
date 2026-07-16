import { deriveRecordFields } from '@/domain/records/record-derived-fields';

import {
  POOP_FUTURE_TOLERANCE_MS,
  PoopValidationError,
  normalizeAndValidatePoopInput,
} from './poop-validation';
import type { PoopCoreInput } from './poop';

const nowMs = new Date(2026, 6, 11, 8, 0).getTime();

function input(overrides: Partial<PoopCoreInput> = {}): PoopCoreInput {
  return {
    eventTimeMs: nowMs,
    color: null,
    texture: null,
    amount: null,
    note: null,
    ...overrides,
  };
}

describe('poop validation', () => {
  test('allows a record containing only an event time', () => {
    expect(normalizeAndValidatePoopInput(input(), nowMs)).toEqual(input());
  });

  test.each(['yellow', 'green', 'brown', 'black', 'red', 'other'] as const)(
    'accepts color %s',
    (color) => expect(normalizeAndValidatePoopInput(input({ color }), nowMs).color).toBe(color),
  );

  test.each(['watery', 'soft', 'mushy', 'formed', 'pellet'] as const)(
    'accepts texture %s',
    (texture) =>
      expect(normalizeAndValidatePoopInput(input({ texture }), nowMs).texture).toBe(texture),
  );

  test.each(['small', 'medium', 'large'] as const)('accepts amount %s', (amount) => {
    expect(normalizeAndValidatePoopInput(input({ amount }), nowMs).amount).toBe(amount);
  });

  test.each([
    ['color', 'blue'],
    ['texture', 'liquid'],
    ['amount', 'huge'],
  ] as const)('rejects invalid %s enum values', (field, value) => {
    expect(() =>
      normalizeAndValidatePoopInput({ ...input(), [field]: value } as PoopCoreInput, nowMs),
    ).toThrow(PoopValidationError);
  });

  test('trims note edges, preserves the body, and enforces 200 characters', () => {
    expect(normalizeAndValidatePoopInput(input({ note: '  前  后  ' }), nowMs).note).toBe('前  后');
    expect(normalizeAndValidatePoopInput(input({ note: '字'.repeat(200) }), nowMs).note).toHaveLength(200);
    expect(() =>
      normalizeAndValidatePoopInput(input({ note: '字'.repeat(201) }), nowMs),
    ).toThrow(PoopValidationError);
  });

  test('allows the shared clock tolerance and rejects a later future time', () => {
    expect(() =>
      normalizeAndValidatePoopInput(input({ eventTimeMs: nowMs + POOP_FUTURE_TOLERANCE_MS }), nowMs),
    ).not.toThrow();
    expect(() =>
      normalizeAndValidatePoopInput(
        input({ eventTimeMs: nowMs + POOP_FUTURE_TOLERANCE_MS + 1 }),
        nowMs,
      ),
    ).toThrow(PoopValidationError);
  });

  test('derives a moved local date from event time', () => {
    const movedTime = new Date(2026, 6, 10, 23, 30).getTime();
    expect(deriveRecordFields({ type: 'poop', eventTimeMs: movedTime })).toEqual({
      recordDate: '2026-07-10',
      sortTimeMs: movedTime,
    });
  });

  test('normalization never carries unrelated record fields', () => {
    const normalized = normalizeAndValidatePoopInput(
      { ...input(), milkAmountMl: 90, sleepStatus: 'sleeping' } as PoopCoreInput,
      nowMs,
    );
    expect(normalized).toEqual(input());
    expect(normalized).not.toHaveProperty('milkAmountMl');
    expect(normalized).not.toHaveProperty('sleepStatus');
  });
});
