import type {
  CompletedSleepUpdateInput,
  SleepStartInput,
} from './sleep';

export const SLEEP_FUTURE_TOLERANCE_MS = 5_000;

export class SleepValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SleepValidationError';
  }
}

function normalizeNote(note: string | null) {
  const normalized = note?.trim() || null;
  if (normalized && normalized.length > 200) {
    throw new SleepValidationError('备注不能超过 200 个字符');
  }
  return normalized;
}

function validateTimestamp(value: number, label: string, nowMs: number) {
  if (!Number.isSafeInteger(value)) throw new SleepValidationError(`${label}无效`);
  if (value > nowMs + SLEEP_FUTURE_TOLERANCE_MS) {
    throw new SleepValidationError(`${label}不能晚于当前时间`);
  }
}

export function normalizeAndValidateSleepStartInput(
  input: SleepStartInput,
  nowMs: number,
): SleepStartInput {
  validateTimestamp(input.startMs, '开始时间', nowMs);
  return { startMs: input.startMs, note: normalizeNote(input.note) };
}

export function normalizeAndValidateCompletedSleepInput(
  input: CompletedSleepUpdateInput,
  nowMs: number,
): CompletedSleepUpdateInput {
  validateTimestamp(input.startMs, '开始时间', nowMs);
  validateTimestamp(input.endMs, '结束时间', nowMs);
  if (input.endMs <= input.startMs) {
    throw new SleepValidationError('结束时间必须晚于开始时间');
  }
  return { startMs: input.startMs, endMs: input.endMs, note: normalizeNote(input.note) };
}

export function serializeSleepStartPayload(input: SleepStartInput) {
  return JSON.stringify({ startMs: input.startMs, note: input.note });
}

export function calculateActiveSleepElapsedMs(startMs: number, nowMs: number) {
  return Math.max(0, nowMs - startMs);
}
