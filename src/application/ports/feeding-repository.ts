import type {
  FeedingCreateInput,
  FeedingDailySummary,
  FeedingRecord,
  FeedingUpdateInput,
} from '@/domain/feeding/feeding';

export interface CreateFeedingCommand {
  id: string;
  clientRequestId: string;
  input: FeedingCreateInput;
  nowMs: number;
}

export interface FeedingRepository {
  create(command: CreateFeedingCommand): Promise<FeedingRecord>;
  getById(id: string): Promise<FeedingRecord | null>;
  getByClientRequestId(clientRequestId: string): Promise<FeedingRecord | null>;
  update(id: string, input: FeedingUpdateInput, nowMs: number): Promise<FeedingRecord>;
  delete(id: string): Promise<void>;
  listByDate(recordDate: string): Promise<FeedingRecord[]>;
  getLatest(): Promise<FeedingRecord | null>;
  getLatestMilkAmount(): Promise<number | null>;
  getLatestMeasured(component: 'formula' | 'bottle_breast'): Promise<{ amountMl: number; eventTimeMs: number } | null>;
  getDailySummary(recordDate: string): Promise<FeedingDailySummary>;
}
