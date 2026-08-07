import type {
  FeedingComponent,
  FeedingCreateInput,
  FeedingType,
  NormalizedFeedingInput,
} from '@/domain/feeding/feeding';
import { inferFeedingComponents } from '@/domain/feeding/feeding';

export const MAX_MILK_AMOUNT_ML = 999;
export const MAX_BREAST_DURATION_MIN = 180;
export const FEEDING_FUTURE_TOLERANCE_MS = 5_000;

export type FeedingValidationField =
  | 'eventTimeMs'
  | 'feedingType'
  | 'milkAmountMl'
  | 'breastMilkAmountMl'
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

function validateAmount(
  value: number | null,
  field: 'milkAmountMl' | 'breastMilkAmountMl',
  label: string,
) {
  if (value === null || !Number.isInteger(value) || value <= 0 || value > MAX_MILK_AMOUNT_ML) {
    throw new FeedingValidationError(field, `${label}必须是1至999ml的整数`);
  }
  return value;
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
  if (value !== 'formula' && value !== 'breast' && value !== 'bottle_breast' && value !== 'mixed') {
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

  const components: FeedingComponent[] = input.feedingType === 'mixed'
    ? inferFeedingComponents({
      ...input,
      breastMilkAmountMl: input.breastMilkAmountMl ?? null,
    })
    : [input.feedingType];
  if (input.feedingType === 'mixed' && components.length < 2) {
    throw new FeedingValidationError('feedingType', '混合喂养至少需要选择两项');
  }

  const hasBreast = components.includes('breast');
  const hasBottleBreast = components.includes('bottle_breast');
  const hasFormula = components.includes('formula');
  const leftDurationMin = hasBreast
    ? validateDuration(input.leftDurationMin, 'leftDurationMin')
    : null;
  const rightDurationMin = hasBreast
    ? validateDuration(input.rightDurationMin, 'rightDurationMin')
    : null;
  if (hasBreast && leftDurationMin === 0 && rightDurationMin === 0) {
    throw new FeedingValidationError('leftDurationMin', '左侧或右侧至少需要记录1分钟');
  }

  return {
    eventTimeMs: input.eventTimeMs,
    feedingType: input.feedingType,
    milkAmountMl: hasFormula ? validateAmount(input.milkAmountMl, 'milkAmountMl', '奶粉量') : null,
    breastMilkAmountMl: hasBottleBreast
      ? validateAmount(input.breastMilkAmountMl, 'breastMilkAmountMl', '瓶喂母乳量')
      : null,
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
    breastMilkAmountMl: input.breastMilkAmountMl,
    leftDurationMin: input.leftDurationMin,
    rightDurationMin: input.rightDurationMin,
    note: input.note,
  });
}
