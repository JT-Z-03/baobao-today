export type FeedingType = 'formula' | 'breast' | 'bottle_breast' | 'mixed';

export type FeedingComponent = 'breast' | 'bottle_breast' | 'formula';

export interface FeedingCreateInput {
  eventTimeMs: number;
  feedingType: FeedingType;
  milkAmountMl: number | null;
  breastMilkAmountMl: number | null;
  leftDurationMin: number | null;
  rightDurationMin: number | null;
  note: string | null;
}

export type NormalizedFeedingInput = FeedingCreateInput;

export type FeedingUpdateInput = FeedingCreateInput;

export function inferFeedingComponents(
  input: Pick<
    FeedingCreateInput,
    'milkAmountMl' | 'breastMilkAmountMl' | 'leftDurationMin' | 'rightDurationMin'
  >,
): FeedingComponent[] {
  const result: FeedingComponent[] = [];
  if (input.leftDurationMin !== null || input.rightDurationMin !== null) result.push('breast');
  if (input.breastMilkAmountMl !== null) result.push('bottle_breast');
  if (input.milkAmountMl !== null) result.push('formula');
  return result;
}

export interface FeedingRecord extends NormalizedFeedingInput {
  type: 'feeding';
  id: string;
  clientRequestId: string;
  createPayloadHash: string;
  recordDate: string;
  sortTimeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface FeedingDailySummary {
  feedingCount: number;
  formulaTotalMl: number;
  breastMilkTotalMl: number;
  measurableTotalMl: number;
}
