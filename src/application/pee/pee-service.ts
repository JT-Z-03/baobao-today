import type { PeeRepository } from '@/application/ports/pee-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { PeeCreateInput, PeeUpdateInput } from '@/domain/pee/pee';

export interface PeeServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  operationCoordinator?: BackupOperationCoordinator;
  assertCurrentDataset?(): Promise<void>;
}

export function createPeeService(repository: PeeRepository, dependencies: PeeServiceDependencies) {
  const runMutation = <T,>(operation: () => Promise<T>) => {
    const guarded = async () => { await dependencies.assertCurrentDataset?.(); return operation(); };
    return dependencies.operationCoordinator?.runExclusive(guarded) ?? guarded();
  };
  return {
    createClientRequestId: dependencies.createClientRequestId,
    getCurrentTimeMs: dependencies.now,
    create(input: PeeCreateInput, clientRequestId: string) {
      return runMutation(() => {
        const nowMs = dependencies.now();
        return repository.create({ id: dependencies.createId(), clientRequestId, input, nowMs });
      });
    },
    getById: (id: string) => repository.getById(id),
    getByClientRequestId: (id: string) => repository.getByClientRequestId(id),
    update: (id: string, input: PeeUpdateInput) =>
      runMutation(() => repository.update(id, input, dependencies.now())),
    delete: (id: string) => runMutation(() => repository.delete(id)),
    getHistory: (recordDate: string) => repository.listByDate(recordDate),
    getDailyCount: (recordDate: string) => repository.getDailyCount(recordDate),
  };
}

export type PeeService = ReturnType<typeof createPeeService>;
