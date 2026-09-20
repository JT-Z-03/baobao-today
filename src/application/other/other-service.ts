import type { OtherRepository } from '@/application/ports/other-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { OtherCreateInput, OtherUpdateInput } from '@/domain/other/other';

export interface OtherServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  operationCoordinator?: BackupOperationCoordinator;
  assertCurrentDataset?(): Promise<void>;
}

export function createOtherService(
  repository: OtherRepository,
  dependencies: OtherServiceDependencies,
) {
  const runMutation = <T,>(operation: () => Promise<T>) => {
    const guarded = async () => { await dependencies.assertCurrentDataset?.(); return operation(); };
    return dependencies.operationCoordinator?.runExclusive(guarded) ?? guarded();
  };
  return {
    createClientRequestId: dependencies.createClientRequestId,
    getCurrentTimeMs: dependencies.now,
    create(input: OtherCreateInput, clientRequestId: string) {
      const nowMs = dependencies.now();
      return runMutation(() => repository.create({
        id: dependencies.createId(), clientRequestId, input, nowMs,
      }));
    },
    getById: (id: string) => repository.getById(id),
    getByClientRequestId: (id: string) => repository.getByClientRequestId(id),
    update: (id: string, input: OtherUpdateInput) =>
      runMutation(() => repository.update(id, input, dependencies.now())),
    delete: (id: string) => runMutation(() => repository.delete(id)),
    getHistory: (recordDate: string) => repository.listByDate(recordDate),
  };
}

export type OtherService = ReturnType<typeof createOtherService>;
