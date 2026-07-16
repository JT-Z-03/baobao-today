import type { FeedingRepository } from '@/application/ports/feeding-repository';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type {
  FeedingReminderSettingsRepository,
  FeedingReminderSyncErrorCode,
  FeedingReminderNavigationResponse,
  NotificationGateway,
  ScheduledFeedingReminder,
} from '@/application/ports/feeding-reminder';
import {
  planFeedingReminder,
  validateFeedingReminderInterval,
  type FeedingReminderPlan,
  type NotificationPermissionStatus,
} from '@/domain/reminders/feeding-reminder-planner';

type Dependencies = {
  settingsRepository: FeedingReminderSettingsRepository;
  feedingRepository: Pick<FeedingRepository, 'getLatest'>;
  notificationGateway: NotificationGateway;
  now(): number;
  operationCoordinator?: BackupOperationCoordinator;
};

type FeedingReminderSyncOptions = {
  forceReschedule?: boolean;
};

type FeedingReminderStatusCommon = {
  intervalMinutes: number | null;
  permissionStatus: NotificationPermissionStatus;
  latestFeedingEventTimeMs: number | null;
};

export type FeedingReminderStatus = FeedingReminderStatusCommon & (
  | (FeedingReminderPlan & { syncErrorCode: null })
  | {
    kind: 'sync-error';
    scheduledForMs: number | null;
    errorCode: FeedingReminderSyncErrorCode;
    syncErrorCode: FeedingReminderSyncErrorCode;
  }
);

function sameReminder(
  reminder: ScheduledFeedingReminder,
  expected: { sourceRecordId: string; scheduledForMs: number },
) {
  return reminder.sourceRecordId === expected.sourceRecordId
    && reminder.scheduledForMs === expected.scheduledForMs;
}

function effectivePermissionStatus(
  permission: { status: NotificationPermissionStatus; canAskAgain: boolean },
  permissionPrompted: boolean,
): NotificationPermissionStatus {
  if (permission.status === 'denied' && permission.canAskAgain && !permissionPrompted) {
    return 'undetermined';
  }
  return permission.status;
}

export function createFeedingReminderService(dependencies: Dependencies) {
  let queue: Promise<unknown> = Promise.resolve();

  async function setError(
    errorCode: FeedingReminderSyncErrorCode,
    input: {
      intervalMinutes: number | null;
      permissionStatus: NotificationPermissionStatus;
      latestFeedingEventTimeMs: number | null;
      scheduledForMs?: number | null;
    },
    clearMetadata: boolean,
  ): Promise<FeedingReminderStatus> {
    try {
      if (clearMetadata) await dependencies.settingsRepository.clearMetadata(errorCode, dependencies.now());
      else await dependencies.settingsRepository.setSyncError(errorCode, dependencies.now());
    } catch {
      // The returned status remains the only safe signal when SQLite error recording also fails.
    }
    return {
      kind: 'sync-error',
      ...input,
      scheduledForMs: input.scheduledForMs ?? null,
      errorCode,
      syncErrorCode: errorCode,
    };
  }

  async function cancelOwned(reminders: readonly ScheduledFeedingReminder[]) {
    for (const reminder of reminders) {
      await dependencies.notificationGateway.cancelScheduledNotification(reminder.identifier);
    }
  }

  async function performSync(options: FeedingReminderSyncOptions = {}): Promise<FeedingReminderStatus> {
    const nowMs = dependencies.now();
    const [settings, permission, latestFeeding, systemReminders] = await Promise.all([
      dependencies.settingsRepository.get(),
      dependencies.notificationGateway.getPermission(),
      dependencies.feedingRepository.getLatest(),
      dependencies.notificationGateway.listFeedingReminders(),
    ]);
    const permissionStatus = effectivePermissionStatus(permission, settings.permissionPrompted);
    const plan = planFeedingReminder({
      intervalMinutes: settings.intervalMinutes,
      permissionStatus,
      latestFeeding,
      nowMs,
    });
    const common = {
      intervalMinutes: settings.intervalMinutes,
      permissionStatus,
      latestFeedingEventTimeMs: latestFeeding?.eventTimeMs ?? null,
    };

    if (plan.kind !== 'scheduled') {
      try {
        await cancelOwned(systemReminders);
      } catch {
        return setError('cancel-failed', common, false);
      }
      await dependencies.settingsRepository.clearMetadata(null, nowMs);
      return { ...plan, ...common, syncErrorCode: null } as FeedingReminderStatus;
    }

    const exact = systemReminders.filter((item) => sameReminder(item, plan));
    if (!options.forceReschedule && systemReminders.length === 1 && exact.length === 1) {
      const reminder = exact[0];
      if (settings.notificationId !== reminder.identifier
        || settings.scheduledForMs !== plan.scheduledForMs
        || settings.sourceRecordId !== plan.sourceRecordId
        || settings.syncErrorCode !== null) {
        try {
          await dependencies.settingsRepository.saveMetadata({
            notificationId: reminder.identifier,
            sourceRecordId: plan.sourceRecordId,
            scheduledForMs: plan.scheduledForMs,
          }, nowMs);
        } catch {
          return setError('metadata-failed', { ...common, scheduledForMs: plan.scheduledForMs }, false);
        }
      }
      return { ...common, ...plan, syncErrorCode: null };
    }

    try {
      await cancelOwned(systemReminders);
    } catch {
      return setError('cancel-failed', { ...common, scheduledForMs: plan.scheduledForMs }, false);
    }

    let notificationId: string;
    try {
      await dependencies.notificationGateway.ensureFeedingChannel();
      notificationId = await dependencies.notificationGateway.scheduleFeedingReminder({
        sourceRecordId: plan.sourceRecordId,
        scheduledForMs: plan.scheduledForMs,
      });
    } catch {
      return setError('schedule-failed', { ...common, scheduledForMs: plan.scheduledForMs }, true);
    }

    try {
      await dependencies.settingsRepository.saveMetadata({
        notificationId,
        sourceRecordId: plan.sourceRecordId,
        scheduledForMs: plan.scheduledForMs,
      }, nowMs);
    } catch {
      try { await dependencies.notificationGateway.cancelScheduledNotification(notificationId); } catch { /* best effort */ }
      return setError('metadata-failed', { ...common, scheduledForMs: plan.scheduledForMs }, true);
    }

    try {
      const confirmed = await dependencies.notificationGateway.listFeedingReminders();
      const valid = confirmed.filter((item) => sameReminder(item, plan));
      if (confirmed.length !== 1 || valid.length !== 1 || valid[0].identifier !== notificationId) {
        await cancelOwned(confirmed);
        return setError('reconcile-failed', { ...common, scheduledForMs: plan.scheduledForMs }, true);
      }
    } catch {
      return setError('reconcile-failed', { ...common, scheduledForMs: plan.scheduledForMs }, false);
    }

    return { ...common, ...plan, syncErrorCode: null };
  }

  function syncFeedingReminder(options: FeedingReminderSyncOptions = {}) {
    const result = queue.then(
      () => performSync(options),
      () => performSync(options),
    );
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function performSetInterval(intervalMinutes: number | null) {
    if (intervalMinutes === null) {
      await dependencies.settingsRepository.setInterval(null, dependencies.now());
      return syncFeedingReminder();
    }
    validateFeedingReminderInterval(intervalMinutes);
    let permission = await dependencies.notificationGateway.getPermission();
    const settings = await dependencies.settingsRepository.get();
    if (permission.status !== 'granted') {
      if (permission.canAskAgain && !settings.permissionPrompted) {
        await dependencies.notificationGateway.ensureFeedingChannel();
        permission = await dependencies.notificationGateway.requestPermission();
        await dependencies.settingsRepository.markPermissionPrompted(dependencies.now());
      }
      if (permission.status !== 'granted') {
        return {
          kind: 'permission-unavailable',
          permissionStatus: permission.status,
          intervalMinutes: settings.intervalMinutes,
          latestFeedingEventTimeMs: null,
          syncErrorCode: null,
        } as FeedingReminderStatus;
      }
    }
    await dependencies.settingsRepository.setInterval(intervalMinutes, dependencies.now());
    return syncFeedingReminder();
  }

  function setInterval(intervalMinutes: number | null) {
    const operation = () => performSetInterval(intervalMinutes);
    return dependencies.operationCoordinator?.runExclusive(operation) ?? operation();
  }

  async function createDevelopmentDuplicateFeedingReminders() {
    const status = await syncFeedingReminder();
    if (status.kind !== 'scheduled') return 0;
    await dependencies.notificationGateway.ensureFeedingChannel();
    await dependencies.notificationGateway.scheduleFeedingReminder({
      sourceRecordId: status.sourceRecordId,
      scheduledForMs: status.scheduledForMs,
    });
    return (await dependencies.notificationGateway.listFeedingReminders()).length;
  }

  async function removeDevelopmentSystemFeedingReminders() {
    const reminders = await dependencies.notificationGateway.listFeedingReminders();
    await cancelOwned(reminders);
    return reminders.length;
  }

  return {
    syncFeedingReminder,
    setInterval,
    openSystemSettings: () => dependencies.notificationGateway.openSystemSettings(),
    scheduleDevelopmentTestReminder: async () => {
      await dependencies.notificationGateway.ensureFeedingChannel();
      return dependencies.notificationGateway.scheduleDevelopmentTestReminder(dependencies.now() + 60_000);
    },
    cancelDevelopmentTestReminders: () =>
      dependencies.notificationGateway.cancelDevelopmentTestReminders(),
    createDevelopmentDuplicateFeedingReminders,
    removeDevelopmentSystemFeedingReminders,
    getLastNavigationResponse: () => dependencies.notificationGateway.getLastNavigationResponse(),
    subscribeToNavigationResponses: (listener: (response: FeedingReminderNavigationResponse) => void) =>
      dependencies.notificationGateway.subscribeToNavigationResponses(listener),
    clearLastNavigationResponse: () => dependencies.notificationGateway.clearLastNavigationResponse(),
  };
}

export type FeedingReminderService = ReturnType<typeof createFeedingReminderService>;
