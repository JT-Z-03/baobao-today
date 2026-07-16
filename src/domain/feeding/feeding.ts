export type FeedingType = 'formula' | 'breast' | 'mixed';

export interface FeedingCreateInput {
  eventTimeMs: number;
  feedingType: FeedingType;
  milkAmountMl: number | null;
  leftDurationMin: number | null;
  rightDurationMin: number | null;
  note: string | null;
}

export type NormalizedFeedingInput = FeedingCreateInput;

export type FeedingUpdateInput = FeedingCreateInput;

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
}
