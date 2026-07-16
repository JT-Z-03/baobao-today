import type {
  FeedingCreateInput,
  FeedingType,
  NormalizedFeedingInput,
} from '@/domain/feeding/feeding';

export const MAX_MILK_AMOUNT_ML = 999;
export const MAX_BREAST_DURATION_MIN = 180;
export const FEEDING_FUTURE_TOLERANCE_MS = 5_000;

type FeedingValidationField =
  | 'eventTimeMs'
  | 'feedingType'
  | 'milkAmountMl'
  | 'leftDurationMin'
  | 'rightDurationMin'
  | 'note';

export class FeedingValidationError extends Error {
  constructor(
    readonly field: FeedingValidationField,
    message: string,
  ) {
    super(message);
    this.name = 'FeedingValidationError';
  }
}

function validateEventTime(eventTimeMs: number, nowMs: number) {
  if (!Number.isInteger(eventTimeMs)) {
    throw new FeedingValidationError('eventTimeMs', '请选择有效的记录时间');
  }
  if (eventTimeMs > nowMs + FEEDING_FUTURE_TOLERANCE_MS) {
    throw new FeedingValidationError('eventTimeMs', '记录时间不能晚于当前时间');
  }
}

function validateMilkAmount(milkAmountMl: number | null) {
  if (
    !Number.isInteger(milkAmountMl) ||
    milkAmountMl === null ||
    milkAmountMl <= 0 ||
    milkAmountMl > MAX_MILK_AMOUNT_ML
  ) {
    throw new FeedingValidationError('milkAmountMl', '奶量必须是1至999ml的整数');
  }
  return milkAmountMl;
}

function validateDuration(value: number | null, field: 'leftDurationMin' | 'rightDurationMin') {
  const normalized = value ?? 0;
  if (
    !Number.isInteger(normalized) ||
    normalized < 0 ||
    normalized > MAX_BREAST_DURATION_MIN
  ) {
    throw new FeedingValidationError(field, '单侧时长必须是0至180分钟的整数');
  }
  return normalized;
}

function normalizeNote(note: string | null) {
  const normalized = note?.trim() || null;
  if (normalized && [...normalized].length > 200) {
    throw new FeedingValidationError('note', '备注不能超过200个字符');
  }
  return normalized;
}

function assertFeedingType(value: FeedingType) {
  if (value !== 'formula' && value !== 'breast' && value !== 'mixed') {
    throw new FeedingValidationError('feedingType', '请选择喂养方式');
  }
}

export function normalizeAndValidateFeedingInput(
  input: FeedingCreateInput,
  nowMs: number,
): NormalizedFeedingInput {
  validateEventTime(input.eventTimeMs, nowMs);
  assertFeedingType(input.feedingType);
  const note = normalizeNote(input.note);

  if (input.feedingType === 'formula') {
    return {
      eventTimeMs: input.eventTimeMs,
      feedingType: input.feedingType,
      milkAmountMl: validateMilkAmount(input.milkAmountMl),
      leftDurationMin: null,
      rightDurationMin: null,
      note,
    };
  }

  const leftDurationMin = validateDuration(input.leftDurationMin, 'leftDurationMin');
  const rightDurationMin = validateDuration(input.rightDurationMin, 'rightDurationMin');
  if (leftDurationMin === 0 && rightDurationMin === 0) {
    throw new FeedingValidationError('leftDurationMin', '左侧或右侧至少需要记录1分钟');
  }

  if (input.feedingType === 'breast') {
    return {
      eventTimeMs: input.eventTimeMs,
      feedingType: input.feedingType,
      milkAmountMl: null,
      leftDurationMin,
      rightDurationMin,
      note,
    };
  }

  return {
    eventTimeMs: input.eventTimeMs,
    feedingType: input.feedingType,
    milkAmountMl: validateMilkAmount(input.milkAmountMl),
    leftDurationMin,
    rightDurationMin,
    note,
  };
}

export function serializeFeedingCreatePayload(input: NormalizedFeedingInput) {
  return JSON.stringify({
    eventTimeMs: input.eventTimeMs,
    feedingType: input.feedingType,
    milkAmountMl: input.milkAmountMl,
    leftDurationMin: input.leftDurationMin,
    rightDurationMin: input.rightDurationMin,
    note: input.note,
  });
}
