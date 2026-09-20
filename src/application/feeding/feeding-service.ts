import type { FeedingRepository } from '@/application/ports/feeding-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { FeedingReminderStatus } from '@/application/reminders/feeding-reminder-service';
import type { FeedingCreateInput, FeedingUpdateInput } from '@/domain/feeding/feeding';
import { inferFeedingComponents, summarizeBreastfeeding } from '@/domain/feeding/feeding';

export interface FeedingServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  syncFeedingReminder?(): Promise<FeedingReminderStatus>;
  operationCoordinator?: BackupOperationCoordinator;
  assertCurrentDataset?(): Promise<void>;
}

export function createFeedingService(
  repository: FeedingRepository,
  dependencies: FeedingServiceDependencies,
) {
  const runMutation = <T,>(operation: () => Promise<T>) => {
    const guarded = async () => { await dependencies.assertCurrentDataset?.(); return operation(); };
    return dependencies.operationCoordinator?.runExclusive(guarded) ?? guarded();
  };
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

    getByClientRequestId(id: string) { return repository.getByClientRequestId(id); },

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
      const [latest, formula, bottleBreast] = await Promise.all([
        repository.getLatest(),
        repository.getLatestMeasured('formula'),
        repository.getLatestMeasured('bottle_breast'),
      ]);
      return {
        eventTimeMs: dependencies.now(),
        feedingType: latest?.feedingType ?? null,
        milkAmountMl: null,
        breastMilkAmountMl: null,
        initialComponents: latest ? inferFeedingComponents(latest) : [],
        historyAmounts: { formula, bottleBreast },
      };
    },

    async getDashboard(recordDate: string) {
      const [latest, timeline, summary] = await Promise.all([
        repository.getLatest(),
        repository.listByDate(recordDate),
        repository.getDailySummary(recordDate),
      ]);
      return { latest, timeline, summary, breastfeeding: summarizeBreastfeeding(timeline), refreshedAtMs: dependencies.now() };
    },

    getHistory(recordDate: string) {
      return repository.listByDate(recordDate);
    },
  };
}

export type FeedingService = ReturnType<typeof createFeedingService>;
