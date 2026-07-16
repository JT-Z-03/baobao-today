import type { PoopCoreInput, PoopRecord } from '@/domain/poop/poop';

export interface CreatePoopCommand {
  id: string;
  clientRequestId: string;
  input: PoopCoreInput;
  photoUri: string | null;
  photoContentFingerprint: string | null;
  nowMs: number;
}

export interface UpdatePoopPersistenceInput extends PoopCoreInput {
  photoUri: string | null;
}

export interface PoopRepository {
  create(command: CreatePoopCommand): Promise<PoopRecord>;
  getById(id: string): Promise<PoopRecord | null>;
  getByClientRequestId(clientRequestId: string): Promise<PoopRecord | null>;
  update(id: string, input: UpdatePoopPersistenceInput, nowMs: number): Promise<PoopRecord>;
  delete(id: string): Promise<void>;
  listByDate(recordDate: string): Promise<PoopRecord[]>;
  getDailyCount(recordDate: string): Promise<number>;
  listReferencedPhotoPaths(): Promise<string[]>;
}
