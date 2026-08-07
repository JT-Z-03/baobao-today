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
  waitForConfirmationRetry?(delayMs: number): Promise<void>;
};

type FeedingReminderSyncOptions = {
  forceReschedule?: boolean;
};

type FeedingReminderStatusCommon = {
  intervalMinutes: number | null;
  permissionStatus: NotificationPermissionStatus;
  latestFeedingEventTimeMs: number | null;
};

// Four native snapshots over at most 1.75 seconds; timer waits yield the JS thread.
const REMINDER_CONFIRMATION_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

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
  const waitForConfirmationRetry = dependencies.waitForConfirmationRetry
    ?? ((delayMs: number) => new Promise<void>((resolve) => { setTimeout(resolve, delayMs); }));

  function enqueue<T>(operation: () => Promise<T>) {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

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

  async function waitForOwnedRemindersToClear() {
    for (let attempt = 0; attempt <= REMINDER_CONFIRMATION_RETRY_DELAYS_MS.length; attempt += 1) {
      const remaining = await dependencies.notificationGateway.listFeedingReminders();
      if (remaining.length === 0) return true;
      await cancelOwned(remaining);
      const retryDelayMs = REMINDER_CONFIRMATION_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs !== undefined) await waitForConfirmationRetry(retryDelayMs);
    }
    return false;
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
    if (systemReminders.length > 0) {
      try {
        if (!await waitForOwnedRemindersToClear()) {
          return setError(
            'reconcile-failed',
            { ...common, scheduledForMs: plan.scheduledForMs },
            true,
          );
        }
      } catch {
        return setError('cancel-failed', { ...common, scheduledForMs: plan.scheduledForMs }, false);
      }
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

    let confirmedNewReminder = false;
    const invalidReminders = new Map<string, ScheduledFeedingReminder>();
    try {
      for (let attempt = 0; attempt <= REMINDER_CONFIRMATION_RETRY_DELAYS_MS.length; attempt += 1) {
        const confirmed = await dependencies.notificationGateway.listFeedingReminders();
        const isValidNewReminder = (item: ScheduledFeedingReminder) =>
          item.identifier === notificationId && sameReminder(item, plan);
        const newReminderIsValid = confirmed.some(isValidNewReminder);
        for (const reminder of confirmed) {
          if (!isValidNewReminder(reminder)) invalidReminders.set(reminder.identifier, reminder);
        }
        confirmedNewReminder ||= newReminderIsValid;
        if (confirmed.length === 1 && newReminderIsValid) {
          return { ...common, ...plan, syncErrorCode: null };
        }
        const retryDelayMs = REMINDER_CONFIRMATION_RETRY_DELAYS_MS[attempt];
        if (retryDelayMs !== undefined) await waitForConfirmationRetry(retryDelayMs);
      }
    } catch { /* handled by the same bounded reconciliation failure below */ }

    if (!confirmedNewReminder) {
      let scheduledCancellationFailed = false;
      try {
        await dependencies.notificationGateway.cancelScheduledNotification(notificationId);
      } catch {
        scheduledCancellationFailed = true;
      }
      const otherInvalidReminders = [...invalidReminders.values()]
        .filter((reminder) => reminder.identifier !== notificationId);
      try { await cancelOwned(otherInvalidReminders); } catch { /* best effort */ }
      return setError(
        'reconcile-failed',
        { ...common, scheduledForMs: plan.scheduledForMs },
        !scheduledCancellationFailed,
      );
    }

    return setError(
      'reconcile-failed',
      { ...common, scheduledForMs: plan.scheduledForMs },
      false,
    );
  }

  function syncFeedingReminder(options: FeedingReminderSyncOptions = {}) {
    return enqueue(() => performSync(options));
  }

  async function performSetInterval(intervalMinutes: number | null) {
    if (intervalMinutes === null) {
      await dependencies.settingsRepository.setInterval(null, dependencies.now());
      return performSync();
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
    return performSync();
  }

  function setInterval(intervalMinutes: number | null) {
    const operation = () => enqueue(() => performSetInterval(intervalMinutes));
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
