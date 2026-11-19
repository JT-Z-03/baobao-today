import type { LocalPhotoSource } from '@/domain/poop/poop';

export interface DraftAttachmentStore {
  isManaged(uri: string): boolean;
  persist(source: LocalPhotoSource): Promise<LocalPhotoSource>;
  remove(uri: string): Promise<void>;
  cleanup(references: ReadonlySet<string>, olderThanMs: number): Promise<void>;
}
