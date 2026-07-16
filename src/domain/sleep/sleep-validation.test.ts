import { deriveRecordFields } from '@/domain/records/record-derived-fields';

import {
  normalizeAndValidateCompletedSleepInput,
  normalizeAndValidateSleepStartInput,
  SleepValidationError,
} from './sleep-validation';

const nowMs = new Date(2026, 6, 11, 12, 0).getTime();

describe('sleep validation', () => {
  test('normalizes a valid start and trims an optional note', () => {
    expect(normalizeAndValidateSleepStartInput({ startMs: nowMs, note: '  nap  ' }, nowMs))
      .toEqual({ startMs: nowMs, note: 'nap' });
  });

  test('allows five seconds of clock tolerance and rejects beyond it', () => {
    expect(normalizeAndValidateSleepStartInput({ startMs: nowMs + 5_000, note: null }, nowMs).startMs)
      .toBe(nowMs + 5_000);
    expect(() => normalizeAndValidateSleepStartInput({ startMs: nowMs + 5_001, note: null }, nowMs))
      .toThrow(SleepValidationError);
  });

  test('requires a completed end after start and within clock tolerance', () => {
    expect(() => normalizeAndValidateCompletedSleepInput(
      { startMs: nowMs - 1, endMs: nowMs - 1, note: null }, nowMs,
    )).toThrow(SleepValidationError);
    expect(() => normalizeAndValidateCompletedSleepInput(
      { startMs: nowMs - 1, endMs: nowMs + 5_001, note: null }, nowMs,
    )).toThrow(SleepValidationError);
  });

  test('does not impose a health-derived maximum duration', () => {
    const startMs = nowMs - 30 * 24 * 60 * 60 * 1_000;
    expect(normalizeAndValidateCompletedSleepInput({ startMs, endMs: nowMs, note: null }, nowMs))
      .toMatchObject({ startMs, endMs: nowMs });
  });

  test('sleep derived fields always follow the start local date', () => {
    const startMs = new Date(2026, 6, 10, 23, 30).getTime();
    expect(deriveRecordFields({ type: 'sleep', sleepStartMs: startMs, sleepEndMs: nowMs }))
      .toEqual({ recordDate: '2026-07-10', sortTimeMs: startMs });
  });
});
