import type { OtherCoreInput } from './other';

export const OTHER_TITLE_MAX_LENGTH = 30;
export const OTHER_NOTE_MAX_LENGTH = 200;
export const OTHER_FUTURE_TOLERANCE_MS = 5_000;

type OtherField = 'eventTimeMs' | 'title' | 'note';

export class OtherValidationError extends Error {
  constructor(readonly field: OtherField, message: string) {
    super(message);
    this.name = 'OtherValidationError';
  }
}

export function normalizeAndValidateOtherInput(
  input: OtherCoreInput,
  nowMs: number,
): OtherCoreInput {
  if (!Number.isSafeInteger(input.eventTimeMs)) {
    throw new OtherValidationError('eventTimeMs', '请选择有效的记录时间');
  }
  if (input.eventTimeMs > nowMs + OTHER_FUTURE_TOLERANCE_MS) {
    throw new OtherValidationError('eventTimeMs', '记录时间不能晚于当前时间');
  }

  const title = input.title.trim();
  if (!title) throw new OtherValidationError('title', '请填写标题');
  if ([...title].length > OTHER_TITLE_MAX_LENGTH) {
    throw new OtherValidationError('title', `标题不能超过${OTHER_TITLE_MAX_LENGTH}个字符`);
  }

  const note = input.note?.trim() || null;
  if (note && [...note].length > OTHER_NOTE_MAX_LENGTH) {
    throw new OtherValidationError('note', `备注不能超过${OTHER_NOTE_MAX_LENGTH}个字符`);
  }

  return { eventTimeMs: input.eventTimeMs, title, note };
}

export function serializeOtherCreatePayload(input: OtherCoreInput) {
  return JSON.stringify({
    eventTimeMs: input.eventTimeMs,
    title: input.title,
    note: input.note,
  });
}
