import type { OtherCreateInput, OtherRecord, OtherUpdateInput } from '@/domain/other/other';

export interface CreateOtherCommand {
  id: string;
  clientRequestId: string;
  input: OtherCreateInput;
  nowMs: number;
}

export interface OtherRepository {
  create(command: CreateOtherCommand): Promise<OtherRecord>;
  getById(id: string): Promise<OtherRecord | null>;
  update(id: string, input: OtherUpdateInput, nowMs: number): Promise<OtherRecord>;
  delete(id: string): Promise<void>;
  listByDate(recordDate: string): Promise<OtherRecord[]>;
}
