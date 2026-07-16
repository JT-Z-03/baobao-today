import type {
  ActiveSleepUpdateInput,
  CompletedSleepUpdateInput,
  FinishSleepResult,
  SleepRecord,
  SleepStartInput,
  StartSleepResult,
} from '@/domain/sleep/sleep';

export type StartSleepCommand = {
  id: string;
  clientRequestId: string;
  input: SleepStartInput;
  nowMs: number;
};

export interface SleepRepository {
  start(command: StartSleepCommand): Promise<StartSleepResult>;
  getById(id: string): Promise<SleepRecord | null>;
  getActive(): Promise<SleepRecord | null>;
  finish(id: string, endMs: number, nowMs: number): Promise<FinishSleepResult>;
  updateActive(id: string, input: ActiveSleepUpdateInput, nowMs: number): Promise<SleepRecord>;
  updateCompleted(id: string, input: CompletedSleepUpdateInput, nowMs: number): Promise<SleepRecord>;
  delete(id: string): Promise<void>;
  listByStartDate(dateKey: string): Promise<SleepRecord[]>;
  listTimelineSources(dateKey: string): Promise<SleepRecord[]>;
  getDailyCompletedTotalMs(dateKey: string): Promise<number>;
}
