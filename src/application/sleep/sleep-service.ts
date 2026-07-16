import type { SleepRepository } from '@/application/ports/sleep-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type {
  ActiveSleepUpdateInput,
  CompletedSleepUpdateInput,
  SleepStartInput,
  SleepTimelineOccurrence,
} from '@/domain/sleep/sleep';
import { projectSleepTimeline } from '@/domain/timeline/timeline-projection';

export interface SleepServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  operationCoordinator?: BackupOperationCoordinator;
}

function projectOccurrences(
  sources: Awaited<ReturnType<SleepRepository['listTimelineSources']>>,
  dateKey: string,
) {
  return sources
    .flatMap((record) => projectSleepTimeline(record, dateKey).map<SleepTimelineOccurrence>((event) => ({
      type: 'sleep-occurrence',
      recordId: record.id,
      kind: event.kind,
      occurrenceTimeMs: event.occurrenceTimeMs,
      sortTimeMs: event.occurrenceTimeMs,
      createdAtMs: record.createdAtMs,
      record,
    })))
    .sort((left, right) =>
      right.occurrenceTimeMs - left.occurrenceTimeMs || right.createdAtMs - left.createdAtMs);
}

export function createSleepService(
  repository: SleepRepository,
  dependencies: SleepServiceDependencies,
) {
  const runMutation = <T,>(operation: () => Promise<T>) =>
    dependencies.operationCoordinator?.runExclusive(operation) ?? operation();
  return {
    createClientRequestId: dependencies.createClientRequestId,
    getCurrentTimeMs: dependencies.now,

    start(input: SleepStartInput, clientRequestId: string) {
      const nowMs = dependencies.now();
      return runMutation(() => repository.start({
        id: dependencies.createId(), clientRequestId, input, nowMs,
      }));
    },

    getById(id: string) {
      return repository.getById(id);
    },

    getActive() {
      return repository.getActive();
    },

    finish(id: string) {
      const nowMs = dependencies.now();
      return runMutation(() => repository.finish(id, nowMs, nowMs));
    },

    finishAt(id: string, endMs: number) {
      return runMutation(() => repository.finish(id, endMs, dependencies.now()));
    },

    updateActive(id: string, input: ActiveSleepUpdateInput) {
      return runMutation(() => repository.updateActive(id, input, dependencies.now()));
    },

    updateCompleted(id: string, input: CompletedSleepUpdateInput) {
      return runMutation(() => repository.updateCompleted(id, input, dependencies.now()));
    },

    delete(id: string) {
      return runMutation(() => repository.delete(id));
    },

    getSourceHistory(dateKey: string) {
      return repository.listByStartDate(dateKey);
    },

    async getTimeline(dateKey: string) {
      return projectOccurrences(await repository.listTimelineSources(dateKey), dateKey);
    },

    async getDashboard(dateKey: string) {
      const [active, sources, completedTotalMs] = await Promise.all([
        repository.getActive(),
        repository.listTimelineSources(dateKey),
        repository.getDailyCompletedTotalMs(dateKey),
      ]);
      return {
        active,
        timeline: projectOccurrences(sources, dateKey),
        completedTotalMs,
        refreshedAtMs: dependencies.now(),
      };
    },
  };
}

export type SleepService = ReturnType<typeof createSleepService>;
