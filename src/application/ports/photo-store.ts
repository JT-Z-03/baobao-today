import type { LocalPhotoSource } from '@/domain/poop/poop';

export interface PreparedPhoto {
  temporaryUri: string;
  contentFingerprint: string;
}

export interface ManagedPhotoEntry {
  relativePath: string;
  lastModifiedMs: number;
}

export interface PhotoStore {
  prepare(source: LocalPhotoSource): Promise<PreparedPhoto>;
  commit(prepared: PreparedPhoto, relativePath: string): Promise<void>;
  discard(prepared: PreparedPhoto): Promise<void>;
  resolve(relativePath: string): Promise<string | null>;
  deleteManaged(relativePath: string): Promise<void>;
  listManaged(): Promise<ManagedPhotoEntry[]>;
}
