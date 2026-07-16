export type SleepStatus = 'sleeping' | 'completed';

type SleepRecordBase = {
  id: string;
  type: 'sleep';
  clientRequestId: string;
  createPayloadHash: string;
  eventTimeMs: number;
  recordDate: string;
  sortTimeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  startMs: number;
  note: string | null;
};

export type SleepingRecord = SleepRecordBase & {
  status: 'sleeping';
  endMs: null;
};

export type CompletedSleepRecord = SleepRecordBase & {
  status: 'completed';
  endMs: number;
};

export type SleepRecord = SleepingRecord | CompletedSleepRecord;

export type SleepStartInput = {
  startMs: number;
  note: string | null;
};

export type ActiveSleepUpdateInput = SleepStartInput;

export type CompletedSleepUpdateInput = {
  startMs: number;
  endMs: number;
  note: string | null;
};

export type StartSleepOutcome = 'created' | 'idempotent' | 'already-active';
export type FinishSleepOutcome = 'completed' | 'already-completed';

export type StartSleepResult = { record: SleepRecord; outcome: StartSleepOutcome };
export type FinishSleepResult = { record: CompletedSleepRecord; outcome: FinishSleepOutcome };

export type SleepTimelineOccurrence = {
  type: 'sleep-occurrence';
  recordId: string;
  kind: 'sleep-start' | 'sleep-end';
  occurrenceTimeMs: number;
  sortTimeMs: number;
  createdAtMs: number;
  record: SleepRecord;
};
