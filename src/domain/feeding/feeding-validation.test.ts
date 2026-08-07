import { deriveRecordFields } from '@/domain/records/record-derived-fields';

import {
  FeedingValidationError,
  normalizeAndValidateFeedingInput,
  serializeFeedingCreatePayload,
} from './feeding-validation';

const nowMs = new Date(2026, 6, 11, 12, 0, 0).getTime();

function input(overrides: Record<string, unknown> = {}) {
  return {
    eventTimeMs: nowMs,
    feedingType: 'formula' as const,
    milkAmountMl: 60,
    breastMilkAmountMl: null,
    leftDurationMin: null,
    rightDurationMin: null,
    note: null,
    ...overrides,
  };
}

describe('feeding validation and normalization', () => {
  test('accepts an integer formula amount and clears breast fields', () => {
    expect(
      normalizeAndValidateFeedingInput(
        input({ leftDurationMin: 12, rightDurationMin: 8, note: '  夜间  ' }),
        nowMs,
      ),
    ).toEqual({
      eventTimeMs: nowMs,
      feedingType: 'formula',
      milkAmountMl: 60,
      breastMilkAmountMl: null,
      leftDurationMin: null,
      rightDurationMin: null,
      note: '夜间',
    });
  });

  test.each([0, -1, 1000, 1.5, Number.NaN])('rejects invalid formula amount %p', (milkAmountMl) => {
    expect(() => normalizeAndValidateFeedingInput(input({ milkAmountMl }), nowMs)).toThrow(
      FeedingValidationError,
    );
  });

  test('accepts breast feeding with only the left side', () => {
    expect(
      normalizeAndValidateFeedingInput(
        input({ feedingType: 'breast', milkAmountMl: 90, leftDurationMin: 15, rightDurationMin: null }),
        nowMs,
      ),
    ).toMatchObject({
      feedingType: 'breast',
      milkAmountMl: null,
      breastMilkAmountMl: null,
      leftDurationMin: 15,
      rightDurationMin: 0,
    });
  });

  test('accepts breast feeding with only the right side', () => {
    expect(
      normalizeAndValidateFeedingInput(
        input({ feedingType: 'breast', milkAmountMl: null, leftDurationMin: 0, rightDurationMin: 12 }),
        nowMs,
      ),
    ).toMatchObject({ leftDurationMin: 0, rightDurationMin: 12 });
  });

  test.each([
    { leftDurationMin: 0, rightDurationMin: 0 },
    { leftDurationMin: -1, rightDurationMin: 10 },
    { leftDurationMin: 181, rightDurationMin: 0 },
    { leftDurationMin: 1.5, rightDurationMin: 0 },
  ])('rejects invalid breast durations %#', (durations) => {
    expect(() =>
      normalizeAndValidateFeedingInput(input({ feedingType: 'breast', milkAmountMl: null, ...durations }), nowMs),
    ).toThrow(FeedingValidationError);
  });

  test('accepts mixed feeding only when breast and formula data both exist', () => {
    expect(
      normalizeAndValidateFeedingInput(
        input({ feedingType: 'mixed', milkAmountMl: 60, leftDurationMin: 10, rightDurationMin: 0 }),
        nowMs,
      ),
    ).toMatchObject({
      feedingType: 'mixed',
      milkAmountMl: 60,
      breastMilkAmountMl: null,
      leftDurationMin: 10,
      rightDurationMin: 0,
    });
  });

  test.each([
    { milkAmountMl: 60, leftDurationMin: 0, rightDurationMin: 0 },
    { milkAmountMl: 0, leftDurationMin: 10, rightDurationMin: 0 },
  ])('rejects incomplete mixed feeding %#', (values) => {
    expect(() =>
      normalizeAndValidateFeedingInput(input({ feedingType: 'mixed', ...values }), nowMs),
    ).toThrow(FeedingValidationError);
  });

  test('clears formula and bottled breast milk fields when changing to breast feeding', () => {
    const normalized = normalizeAndValidateFeedingInput(
      input({
        feedingType: 'breast',
        milkAmountMl: 80,
        breastMilkAmountMl: 80,
        leftDurationMin: 8,
        rightDurationMin: 0,
      }),
      nowMs,
    );

    expect(normalized.milkAmountMl).toBeNull();
    expect(normalized.breastMilkAmountMl).toBeNull();
  });

  test('allows clock skew up to five seconds and rejects a later future time', () => {
    expect(() =>
      normalizeAndValidateFeedingInput(input({ eventTimeMs: nowMs + 5_000 }), nowMs),
    ).not.toThrow();
    expect(() =>
      normalizeAndValidateFeedingInput(input({ eventTimeMs: nowMs + 5_001 }), nowMs),
    ).toThrow(FeedingValidationError);
  });

  test('derives a new record date when feeding time moves across a local day', () => {
    const eventTimeMs = new Date(2026, 6, 10, 23, 59).getTime();

    expect(deriveRecordFields({ type: 'feeding', eventTimeMs })).toEqual({
      recordDate: '2026-07-10',
      sortTimeMs: eventTimeMs,
    });
  });

  test('serializes normalized create payload deterministically', () => {
    const normalized = normalizeAndValidateFeedingInput(input({ note: '' }), nowMs);

    expect(serializeFeedingCreatePayload(normalized)).toBe(
      `{"eventTimeMs":${nowMs},"feedingType":"formula","milkAmountMl":60,"breastMilkAmountMl":null,"leftDurationMin":null,"rightDurationMin":null,"note":null}`,
    );
  });

  test('accepts bottled breast milk and clears formula and duration fields', () => {
    expect(
      normalizeAndValidateFeedingInput(
        input({
          feedingType: 'bottle_breast',
          milkAmountMl: null,
          breastMilkAmountMl: 80,
        }),
        nowMs,
      ),
    ).toMatchObject({
      feedingType: 'bottle_breast',
      milkAmountMl: null,
      breastMilkAmountMl: 80,
      leftDurationMin: null,
      rightDurationMin: null,
    });
  });

  test.each([
    { milkAmountMl: null, breastMilkAmountMl: 80, leftDurationMin: 10, rightDurationMin: 0 },
    { milkAmountMl: 40, breastMilkAmountMl: null, leftDurationMin: 10, rightDurationMin: 0 },
    { milkAmountMl: 40, breastMilkAmountMl: 80, leftDurationMin: null, rightDurationMin: null },
    { milkAmountMl: 40, breastMilkAmountMl: 80, leftDurationMin: 10, rightDurationMin: 0 },
  ])('accepts valid mixed components %#', (values) => {
    expect(
      normalizeAndValidateFeedingInput(input({ feedingType: 'mixed', ...values }), nowMs),
    ).toMatchObject({ feedingType: 'mixed', ...values });
  });

  test.each([
    { milkAmountMl: 40, breastMilkAmountMl: null, leftDurationMin: null, rightDurationMin: null },
    { milkAmountMl: null, breastMilkAmountMl: 80, leftDurationMin: null, rightDurationMin: null },
    { milkAmountMl: null, breastMilkAmountMl: null, leftDurationMin: 10, rightDurationMin: 0 },
  ])('rejects mixed feeding with only one component %#', (values) => {
    expect(() =>
      normalizeAndValidateFeedingInput(input({ feedingType: 'mixed', ...values }), nowMs),
    ).toThrow(FeedingValidationError);
  });
});
