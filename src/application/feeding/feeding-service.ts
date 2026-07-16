import type { FeedingRepository } from '@/application/ports/feeding-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { FeedingReminderStatus } from '@/application/reminders/feeding-reminder-service';
import type { FeedingCreateInput, FeedingUpdateInput } from '@/domain/feeding/feeding';

export interface FeedingServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  syncFeedingReminder?(): Promise<FeedingReminderStatus>;
  operationCoordinator?: BackupOperationCoordinator;
}

export function createFeedingService(
  repository: FeedingRepository,
  dependencies: FeedingServiceDependencies,
) {
  const runMutation = <T,>(operation: () => Promise<T>) =>
    dependencies.operationCoordinator?.runExclusive(operation) ?? operation();
  async function syncAfterMutation(): Promise<FeedingReminderStatus | null> {
    if (!dependencies.syncFeedingReminder) return null;
    try {
      return await dependencies.syncFeedingReminder();
    } catch {
      return {
        kind: 'sync-error',
        intervalMinutes: null,
        permissionStatus: 'undetermined',
        latestFeedingEventTimeMs: null,
        scheduledForMs: null,
        errorCode: 'reconcile-failed',
        syncErrorCode: 'reconcile-failed',
      };
    }
  }

  return {
    createClientRequestId: dependencies.createClientRequestId,
    getCurrentTimeMs: dependencies.now,

    async create(input: FeedingCreateInput, clientRequestId: string) {
      return runMutation(async () => {
        const nowMs = dependencies.now();
        const record = await repository.create({
          id: dependencies.createId(), clientRequestId, input, nowMs,
        });
        return { record, reminderStatus: await syncAfterMutation() };
      });
    },

    getById(id: string) {
      return repository.getById(id);
    },

    async update(id: string, input: FeedingUpdateInput) {
      return runMutation(async () => {
        const record = await repository.update(id, input, dependencies.now());
        return { record, reminderStatus: await syncAfterMutation() };
      });
    },

    async delete(id: string) {
      return runMutation(async () => {
        await repository.delete(id);
        return { reminderStatus: await syncAfterMutation() };
      });
    },

    async getNewRecordDefaults() {
      const [latest, latestMilkAmount] = await Promise.all([
        repository.getLatest(),
        repository.getLatestMilkAmount(),
      ]);
      return {
        eventTimeMs: dependencies.now(),
        feedingType: latest?.feedingType ?? ('formula' as const),
        milkAmountMl: latestMilkAmount ?? 60,
      };
    },

    async getDashboard(recordDate: string) {
      const [latest, timeline, summary] = await Promise.all([
        repository.getLatest(),
        repository.listByDate(recordDate),
        repository.getDailySummary(recordDate),
      ]);
      return { latest, timeline, summary, refreshedAtMs: dependencies.now() };
    },

    getHistory(recordDate: string) {
      return repository.listByDate(recordDate);
    },
  };
}

export type FeedingService = ReturnType<typeof createFeedingService>;
