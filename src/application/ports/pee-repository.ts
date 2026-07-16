import type { PeeCreateInput, PeeRecord, PeeUpdateInput } from '@/domain/pee/pee';

export interface CreatePeeCommand {
  id: string;
  clientRequestId: string;
  input: PeeCreateInput;
  nowMs: number;
}

export interface PeeRepository {
  create(command: CreatePeeCommand): Promise<PeeRecord>;
  getById(id: string): Promise<PeeRecord | null>;
  update(id: string, input: PeeUpdateInput, nowMs: number): Promise<PeeRecord>;
  delete(id: string): Promise<void>;
  listByDate(recordDate: string): Promise<PeeRecord[]>;
  getDailyCount(recordDate: string): Promise<number>;
}
