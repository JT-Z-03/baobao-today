import type { BabyRepository } from '@/application/ports/baby-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { BabyProfile } from '@/domain/baby/baby';
import { type BabyProfileInput, validateBabyProfile } from '@/domain/baby/baby-profile';

type SaveBabyProfileDependencies = {
  repository: Pick<BabyRepository, 'save'>;
  todayDate: string;
  nowMs: number;
  createId: () => string;
  operationCoordinator?: BackupOperationCoordinator;
};

export async function saveBabyProfile(
  input: BabyProfileInput,
  dependencies: SaveBabyProfileDependencies,
) {
  const error = validateBabyProfile(input, dependencies.todayDate);
  if (error) return { ok: false as const, error };

  const profile: BabyProfile = {
    id: dependencies.createId(),
    name: input.name.trim(),
    birthDate: input.birthDate,
    createdAtMs: dependencies.nowMs,
    updatedAtMs: dependencies.nowMs,
  };
  const save = () => dependencies.repository.save(profile);
  return {
    ok: true as const,
    profile: await (dependencies.operationCoordinator?.runExclusive(save) ?? save()),
  };
}
