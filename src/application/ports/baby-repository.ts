import type { BabyProfile } from '@/domain/baby/baby';

export interface BabyRepository {
  get(): Promise<BabyProfile | null>;
  save(profile: BabyProfile): Promise<BabyProfile>;
}
