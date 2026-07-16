import type {
  PoopAmount,
  PoopColor,
  PoopCoreInput,
  PoopTexture,
} from '@/domain/poop/poop';

export const POOP_FUTURE_TOLERANCE_MS = 5_000;

type PoopField = 'eventTimeMs' | 'color' | 'texture' | 'amount' | 'note';

export class PoopValidationError extends Error {
  constructor(readonly field: PoopField, message: string) {
    super(message);
    this.name = 'PoopValidationError';
  }
}

const colors = new Set<PoopColor>(['yellow', 'green', 'brown', 'black', 'red', 'other']);
const textures = new Set<PoopTexture>(['watery', 'soft', 'mushy', 'formed', 'pellet']);
const amounts = new Set<PoopAmount>(['small', 'medium', 'large']);

function optionalEnum<T extends string>(
  value: T | null,
  allowed: ReadonlySet<T>,
  field: PoopField,
  message: string,
) {
  if (value !== null && !allowed.has(value)) throw new PoopValidationError(field, message);
  return value;
}

export function normalizeAndValidatePoopInput(input: PoopCoreInput, nowMs: number): PoopCoreInput {
  if (!Number.isInteger(input.eventTimeMs)) {
    throw new PoopValidationError('eventTimeMs', '请选择有效的记录时间');
  }
  if (input.eventTimeMs > nowMs + POOP_FUTURE_TOLERANCE_MS) {
    throw new PoopValidationError('eventTimeMs', '记录时间不能晚于当前时间');
  }

  const note = input.note?.trim() || null;
  if (note && [...note].length > 200) {
    throw new PoopValidationError('note', '备注不能超过200个字符');
  }

  return {
    eventTimeMs: input.eventTimeMs,
    color: optionalEnum(input.color, colors, 'color', '请选择有效的大便颜色'),
    texture: optionalEnum(input.texture, textures, 'texture', '请选择有效的大便状态'),
    amount: optionalEnum(input.amount, amounts, 'amount', '请选择有效的大便量'),
    note,
  };
}

export function serializePoopCreatePayload(
  input: PoopCoreInput,
  photoUri: string | null,
  photoContentFingerprint: string | null,
) {
  return JSON.stringify({
    eventTimeMs: input.eventTimeMs,
    color: input.color,
    texture: input.texture,
    amount: input.amount,
    note: input.note,
    photoUri,
    photoContentFingerprint,
  });
}
