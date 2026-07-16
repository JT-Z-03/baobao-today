import type { PeeAmount, PeeColor, PeeCoreInput } from '@/domain/pee/pee';

export const PEE_FUTURE_TOLERANCE_MS = 5_000;

type PeeField = 'eventTimeMs' | 'amount' | 'color' | 'note';

export class PeeValidationError extends Error {
  constructor(readonly field: PeeField, message: string) {
    super(message);
    this.name = 'PeeValidationError';
  }
}

const amounts = new Set<PeeAmount>(['small', 'medium', 'large']);
const colors = new Set<PeeColor>(['clear', 'light_yellow', 'yellow', 'dark_yellow']);

function optionalEnum<T extends string>(
  value: T | null,
  allowed: ReadonlySet<T>,
  field: PeeField,
  message: string,
) {
  if (value !== null && !allowed.has(value)) throw new PeeValidationError(field, message);
  return value;
}

export function normalizeAndValidatePeeInput(input: PeeCoreInput, nowMs: number): PeeCoreInput {
  if (!Number.isInteger(input.eventTimeMs)) {
    throw new PeeValidationError('eventTimeMs', '请选择有效的记录时间');
  }
  if (input.eventTimeMs > nowMs + PEE_FUTURE_TOLERANCE_MS) {
    throw new PeeValidationError('eventTimeMs', '记录时间不能晚于当前时间');
  }

  const note = input.note?.trim() || null;
  if (note && [...note].length > 200) {
    throw new PeeValidationError('note', '备注不能超过200个字符');
  }

  return {
    eventTimeMs: input.eventTimeMs,
    amount: optionalEnum(input.amount, amounts, 'amount', '请选择有效的尿量'),
    color: optionalEnum(input.color, colors, 'color', '请选择有效的尿液颜色'),
    note,
  };
}

export function serializePeeCreatePayload(input: PeeCoreInput) {
  return JSON.stringify({
    eventTimeMs: input.eventTimeMs,
    amount: input.amount,
    color: input.color,
    note: input.note,
  });
}
