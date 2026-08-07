import type { FeedingRepository } from '@/application/ports/feeding-repository';
import type {
  FeedingReminderSettingsRepository,
  FeedingReminderSettings,
  NotificationGateway,
  ScheduledFeedingReminder,
} from '@/application/ports/feeding-reminder';
import type { FeedingRecord } from '@/domain/feeding/feeding';

import { createFeedingReminderService } from './feeding-reminder-service';

const nowMs = new Date(2026, 6, 11, 12, 0).getTime();
const feeding: FeedingRecord = {
  id: 'feeding-1', type: 'feeding', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
  eventTimeMs: nowMs - 30 * 60_000, recordDate: '2026-07-11', sortTimeMs: nowMs - 30 * 60_000,
  createdAtMs: nowMs - 30 * 60_000, updatedAtMs: nowMs - 30 * 60_000,
  feedingType: 'bottle_breast', milkAmountMl: null, breastMilkAmountMl: 80,
  leftDurationMin: null, rightDurationMin: null, note: null,
};
const scheduledForMs = feeding.eventTimeMs + 120 * 60_000;

function settingsRepository(overrides: Partial<FeedingReminderSettingsRepository> = {}) {
  const settings: FeedingReminderSettings = {
    intervalMinutes: 120, notificationId: null, scheduledForMs: null, sourceRecordId: null,
    permissionPrompted: false, syncErrorCode: null, updatedAtMs: 0,
  };
  return {
    get: jest.fn(async () => ({ ...settings })),
    setInterval: jest.fn(async (intervalMinutes: number | null) => {
      settings.intervalMinutes = intervalMinutes;
      if (intervalMinutes === null) {
        settings.notificationId = null; settings.scheduledForMs = null; settings.sourceRecordId = null;
      }
    }),
    markPermissionPrompted: jest.fn(async () => { settings.permissionPrompted = true; }),
    saveMetadata: jest.fn(async (metadata) => {
      settings.notificationId = metadata.notificationId;
      settings.scheduledForMs = metadata.scheduledForMs;
      settings.sourceRecordId = metadata.sourceRecordId;
      settings.syncErrorCode = null;
    }),
    clearMetadata: jest.fn(async (errorCode = null) => {
      settings.notificationId = null; settings.scheduledForMs = null; settings.sourceRecordId = null;
      settings.syncErrorCode = errorCode;
    }),
    setSyncError: jest.fn(async (errorCode) => { settings.syncErrorCode = errorCode; }),
    ...overrides,
  } as jest.Mocked<FeedingReminderSettingsRepository>;
}

function gateway(system: ScheduledFeedingReminder[] = [], overrides: Partial<NotificationGateway> = {}) {
  const result = {
    ensureFeedingChannel: jest.fn(async () => undefined),
    getPermission: jest.fn(async () => ({ status: 'granted' as const, canAskAgain: true })),
    requestPermission: jest.fn(async () => ({ status: 'granted' as const, canAskAgain: true })),
    listFeedingReminders: jest.fn(async () => [...system]),
    scheduleFeedingReminder: jest.fn(async (input) => {
      system.splice(0, system.length, { identifier: 'new-native-id', ...input });
      return 'new-native-id';
    }),
    cancelScheduledNotification: jest.fn(async (identifier) => {
      const index = system.findIndex((item) => item.identifier === identifier);
      if (index >= 0) system.splice(index, 1);
    }),
    openSystemSettings: jest.fn(async () => undefined),
    scheduleDevelopmentTestReminder: jest.fn(async () => 'dev-id'),
    cancelDevelopmentTestReminders: jest.fn(async () => undefined),
    getLastNavigationResponse: jest.fn(async () => null),
    subscribeToNavigationResponses: jest.fn(() => ({ remove: jest.fn() })),
    clearLastNavigationResponse: jest.fn(async () => undefined),
  };
  return { ...result, ...overrides } as jest.Mocked<NotificationGateway>;
}

function cancellationVisibilityLagGateway(settles: boolean) {
  const oldReminder = {
    identifier: 'old-native-id',
    sourceRecordId: 'old-feeding',
    scheduledForMs: scheduledForMs - 1,
  };
  const system = [oldReminder];
  const pendingCancellationReads = new Map<string, number>();
  const notifications: NotificationGateway = {
    ensureFeedingChannel: async () => undefined,
    getPermission: async () => ({ status: 'granted', canAskAgain: true }),
    requestPermission: async () => ({ status: 'granted', canAskAgain: true }),
    listFeedingReminders: async () => {
      for (const [identifier, remainingReads] of pendingCancellationReads) {
        if (remainingReads !== 0) continue;
        const index = system.findIndex((item) => item.identifier === identifier);
        if (index >= 0) system.splice(index, 1);
        pendingCancellationReads.delete(identifier);
      }
      const snapshot = system.map((item) => ({ ...item }));
      for (const [identifier, remainingReads] of pendingCancellationReads) {
        if (remainingReads > 0) pendingCancellationReads.set(identifier, remainingReads - 1);
      }
      return snapshot;
    },
    scheduleFeedingReminder: async (input) => {
      system.push({ identifier: 'new-native-id', ...input });
      return 'new-native-id';
    },
    cancelScheduledNotification: async (identifier) => {
      if (identifier === oldReminder.identifier) {
        if (settles && !pendingCancellationReads.has(identifier)) {
          pendingCancellationReads.set(identifier, 1);
        }
        return;
      }
      const index = system.findIndex((item) => item.identifier === identifier);
      if (index >= 0) system.splice(index, 1);
    },
    openSystemSettings: async () => undefined,
    scheduleDevelopmentTestReminder: async () => 'dev-id',
    cancelDevelopmentTestReminders: async () => undefined,
    getLastNavigationResponse: async () => null,
    subscribeToNavigationResponses: () => ({ remove: () => undefined }),
    clearLastNavigationResponse: async () => undefined,
  };
  return notifications as jest.Mocked<NotificationGateway>;
}

function delayedNativeVisibilityGateway() {
  const oldReminder = {
    identifier: 'old-native-id',
    sourceRecordId: feeding.id,
    scheduledForMs,
  };
  let nativeTick = 0;
  let oldCancellationRequested = false;
  let newScheduleRequested = false;
  let newScheduleSurvived = false;
  const notifications: NotificationGateway = {
    ensureFeedingChannel: async () => undefined,
    getPermission: async () => ({ status: 'granted', canAskAgain: true }),
    requestPermission: async () => ({ status: 'granted', canAskAgain: true }),
    listFeedingReminders: async () => {
      const snapshot: ScheduledFeedingReminder[] = [];
      if (!oldCancellationRequested || nativeTick < 2) snapshot.push({ ...oldReminder });
      if (newScheduleRequested && newScheduleSurvived && nativeTick >= 3) {
        snapshot.push({ identifier: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs });
      }
      return snapshot;
    },
    scheduleFeedingReminder: async () => {
      newScheduleRequested = true;
      newScheduleSurvived = !oldCancellationRequested || nativeTick >= 2;
      return 'new-native-id';
    },
    cancelScheduledNotification: async (identifier) => {
      if (identifier === oldReminder.identifier) oldCancellationRequested = true;
    },
    openSystemSettings: async () => undefined,
    scheduleDevelopmentTestReminder: async () => 'dev-id',
    cancelDevelopmentTestReminders: async () => undefined,
    getLastNavigationResponse: async () => null,
    subscribeToNavigationResponses: () => ({ remove: () => undefined }),
    clearLastNavigationResponse: async () => undefined,
  };
  return {
    notifications: notifications as jest.Mocked<NotificationGateway>,
    waitForConfirmationRetry: async () => { nativeTick += 1; },
  };
}

function feedingRepository(latest: FeedingRecord | null = feeding) {
  return { getLatest: jest.fn(async () => latest) } as unknown as jest.Mocked<FeedingRepository>;
}

function service(input: {
  settings?: jest.Mocked<FeedingReminderSettingsRepository>;
  gateway?: jest.Mocked<NotificationGateway>;
  latest?: FeedingRecord | null;
  waitForConfirmationRetry?: (delayMs: number) => Promise<void>;
} = {}) {
  const repository = input.settings ?? settingsRepository();
  const notifications = input.gateway ?? gateway();
  const dependencies: Parameters<typeof createFeedingReminderService>[0] = {
    settingsRepository: repository,
    feedingRepository: feedingRepository(input.latest),
    notificationGateway: notifications,
    now: () => nowMs,
    waitForConfirmationRetry: input.waitForConfirmationRetry ?? (async () => undefined),
  };
  return {
    repository,
    notifications,
    service: createFeedingReminderService(dependencies),
  };
}

describe('feeding reminder reconciliation', () => {
  test('cancels owned reminders and clears metadata when disabled, denied, missing, or expired', async () => {
    for (const variant of ['disabled', 'denied', 'missing', 'expired'] as const) {
      const native = { identifier: `old-${variant}`, sourceRecordId: 'old', scheduledForMs: nowMs + 1 };
      const settings = settingsRepository();
      if (variant === 'disabled') await settings.setInterval(null, 0);
      const notifications = gateway([native], variant === 'denied'
        ? { getPermission: jest.fn(async () => ({ status: 'denied' as const, canAskAgain: false })) }
        : {});
      const latest = variant === 'missing' ? null : variant === 'expired'
        ? { ...feeding, eventTimeMs: nowMs - 3 * 60 * 60_000 }
        : feeding;
      const instance = service({ settings, gateway: notifications, latest });
      await instance.service.syncFeedingReminder();
      expect(notifications.cancelScheduledNotification).toHaveBeenCalledWith(native.identifier);
      expect(settings.clearMetadata).toHaveBeenCalledWith(null, nowMs);
      expect(notifications.scheduleFeedingReminder).not.toHaveBeenCalled();
    }
  });

  test('keeps one exact system reminder without canceling or rebuilding it', async () => {
    const exact = { identifier: 'native-1', sourceRecordId: feeding.id, scheduledForMs };
    const settings = settingsRepository();
    await settings.saveMetadata({ notificationId: exact.identifier, scheduledForMs, sourceRecordId: feeding.id }, 0);
    const notifications = gateway([exact]);
    const instance = service({ settings, gateway: notifications });
    await expect(instance.service.syncFeedingReminder()).resolves.toMatchObject({ kind: 'scheduled', scheduledForMs });
    expect(notifications.cancelScheduledNotification).not.toHaveBeenCalled();
    expect(notifications.scheduleFeedingReminder).not.toHaveBeenCalled();
  });

  test('rebuilds an exact stored reminder during cold-start recovery', async () => {
    const exact = { identifier: 'ghost-after-force-stop', sourceRecordId: feeding.id, scheduledForMs };
    const settings = settingsRepository();
    await settings.saveMetadata({ notificationId: exact.identifier, scheduledForMs, sourceRecordId: feeding.id }, 0);
    const notifications = gateway([exact]);
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'scheduled', scheduledForMs });

    expect(notifications.cancelScheduledNotification).toHaveBeenCalledWith(exact.identifier);
    expect(notifications.scheduleFeedingReminder).toHaveBeenCalledWith({
      sourceRecordId: feeding.id,
      scheduledForMs,
    });
  });

  test('adopts an exact system reminder when database metadata is missing', async () => {
    const exact = { identifier: 'native-existing', sourceRecordId: feeding.id, scheduledForMs };
    const settings = settingsRepository();
    const notifications = gateway([exact]);
    await service({ settings, gateway: notifications }).service.syncFeedingReminder();
    expect(settings.saveMetadata).toHaveBeenCalledWith({
      notificationId: exact.identifier, scheduledForMs, sourceRecordId: feeding.id,
    }, nowMs);
    expect(notifications.scheduleFeedingReminder).not.toHaveBeenCalled();
  });

  test('replaces stale or duplicate owned reminders and converges to one', async () => {
    const stale = { identifier: 'stale', sourceRecordId: 'old', scheduledForMs: scheduledForMs - 1 };
    const duplicate = { identifier: 'duplicate', sourceRecordId: feeding.id, scheduledForMs };
    const notifications = gateway([stale, duplicate]);
    const settings = settingsRepository();
    await service({ settings, gateway: notifications }).service.syncFeedingReminder();
    expect(notifications.cancelScheduledNotification).toHaveBeenCalledWith('stale');
    expect(notifications.cancelScheduledNotification).toHaveBeenCalledWith('duplicate');
    expect(notifications.scheduleFeedingReminder).toHaveBeenCalledWith({
      sourceRecordId: feeding.id, scheduledForMs,
    });
    expect(settings.saveMetadata).toHaveBeenCalledWith({
      notificationId: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
    }, nowMs);
  });

  test('converges when a canceled reminder remains visible in the first confirmation snapshot', async () => {
    const settings = settingsRepository();
    const notifications = cancellationVisibilityLagGateway(true);
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'scheduled', scheduledForMs, syncErrorCode: null });

    await expect(notifications.listFeedingReminders()).resolves.toEqual([{
      identifier: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
    }]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs, syncErrorCode: null,
    });
  });

  test('waits for old cancellation to settle before scheduling its replacement', async () => {
    const settings = settingsRepository();
    const delayedNative = delayedNativeVisibilityGateway();
    const instance = service({
      settings,
      gateway: delayedNative.notifications,
      waitForConfirmationRetry: delayedNative.waitForConfirmationRetry,
    });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'scheduled', scheduledForMs, syncErrorCode: null });

    await expect(delayedNative.notifications.listFeedingReminders()).resolves.toEqual([{
      identifier: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
    }]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs, syncErrorCode: null,
    });
  });

  test('does not schedule a replacement while an old reminder cannot be cleared', async () => {
    const settings = settingsRepository();
    const notifications = cancellationVisibilityLagGateway(false);
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    await expect(notifications.listFeedingReminders()).resolves.toEqual([
      { identifier: 'old-native-id', sourceRecordId: 'old-feeding', scheduledForMs: scheduledForMs - 1 },
    ]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: null, sourceRecordId: null, scheduledForMs: null,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('reports a post-schedule persistent duplicate without deleting a confirmed new reminder', async () => {
    const system: ScheduledFeedingReminder[] = [];
    const settings = settingsRepository();
    const notifications = gateway(system, {
      scheduleFeedingReminder: jest.fn(async (input) => {
        system.push(
          { identifier: 'new-native-id', ...input },
          { identifier: 'persistent-duplicate', sourceRecordId: 'unexpected', scheduledForMs: scheduledForMs - 1 },
        );
        return 'new-native-id';
      }),
      cancelScheduledNotification: jest.fn(async (identifier) => {
        if (identifier === 'persistent-duplicate') return;
        const index = system.findIndex((item) => item.identifier === identifier);
        if (index >= 0) system.splice(index, 1);
      }),
    });
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    expect(system).toEqual([
      { identifier: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs },
      { identifier: 'persistent-duplicate', sourceRecordId: 'unexpected', scheduledForMs: scheduledForMs - 1 },
    ]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('cancels a same-id reminder whose payload does not match the plan', async () => {
    const system: ScheduledFeedingReminder[] = [];
    const settings = settingsRepository();
    const notifications = gateway(system, {
      scheduleFeedingReminder: jest.fn(async () => {
        system.push({
          identifier: 'new-native-id',
          sourceRecordId: 'wrong-feeding',
          scheduledForMs: scheduledForMs - 1,
        });
        return 'new-native-id';
      }),
    });
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    expect(system).toEqual([]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: null, sourceRecordId: null, scheduledForMs: null,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('cancels the known scheduled id when confirmation listing fails', async () => {
    const system: ScheduledFeedingReminder[] = [];
    const settings = settingsRepository();
    const notifications = gateway(system, {
      listFeedingReminders: jest.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValue(new Error('native list failed')),
    });
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    expect(system).toEqual([]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: null, sourceRecordId: null, scheduledForMs: null,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('keeps metadata when canceling an unconfirmed scheduled id fails', async () => {
    const system: ScheduledFeedingReminder[] = [];
    const settings = settingsRepository();
    const notifications = gateway(system, {
      listFeedingReminders: jest.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValue(new Error('native list failed')),
      cancelScheduledNotification: jest.fn(async () => { throw new Error('native cancel failed'); }),
    });
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    expect(system).toEqual([{
      identifier: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
    }]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: 'new-native-id', sourceRecordId: feeding.id, scheduledForMs,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('clears canceled metadata even when another invalid reminder cleanup fails', async () => {
    const system: ScheduledFeedingReminder[] = [];
    const invalid = {
      identifier: 'invalid-native-id',
      sourceRecordId: 'unexpected',
      scheduledForMs: scheduledForMs - 1,
    };
    const settings = settingsRepository();
    const notifications = gateway(system, {
      listFeedingReminders: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([invalid]),
      scheduleFeedingReminder: jest.fn(async (input) => {
        system.push({ identifier: 'new-native-id', ...input }, invalid);
        return 'new-native-id';
      }),
      cancelScheduledNotification: jest.fn(async (identifier) => {
        if (identifier === invalid.identifier) throw new Error('invalid cleanup failed');
        const index = system.findIndex((item) => item.identifier === identifier);
        if (index >= 0) system.splice(index, 1);
      }),
    });
    const instance = service({ settings, gateway: notifications });

    await expect(instance.service.syncFeedingReminder({ forceReschedule: true }))
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'reconcile-failed' });

    expect(system).toEqual([invalid]);
    await expect(settings.get()).resolves.toMatchObject({
      notificationId: null, sourceRecordId: null, scheduledForMs: null,
      syncErrorCode: 'reconcile-failed',
    });
  });

  test('does not schedule a replacement when canceling stale reminders fails', async () => {
    const settings = settingsRepository();
    const notifications = gateway(
      [{ identifier: 'stale', sourceRecordId: 'old', scheduledForMs }],
      { cancelScheduledNotification: jest.fn(async () => { throw new Error('cancel failed'); }) },
    );
    await expect(service({ settings, gateway: notifications }).service.syncFeedingReminder())
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'cancel-failed' });
    expect(notifications.scheduleFeedingReminder).not.toHaveBeenCalled();
    expect(settings.setSyncError).toHaveBeenCalledWith('cancel-failed', nowMs);
  });

  test('does not write false metadata when scheduling fails', async () => {
    const settings = settingsRepository();
    const notifications = gateway([], {
      scheduleFeedingReminder: jest.fn(async () => { throw new Error('schedule failed'); }),
    });
    await expect(service({ settings, gateway: notifications }).service.syncFeedingReminder())
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'schedule-failed' });
    expect(settings.saveMetadata).not.toHaveBeenCalled();
    expect(settings.clearMetadata).toHaveBeenCalledWith('schedule-failed', nowMs);
  });

  test('cancels a newly scheduled notification when metadata persistence fails', async () => {
    const settings = settingsRepository({
      saveMetadata: jest.fn(async () => { throw new Error('db failed'); }),
    });
    const notifications = gateway([]);
    await expect(service({ settings, gateway: notifications }).service.syncFeedingReminder())
      .resolves.toMatchObject({ kind: 'sync-error', errorCode: 'metadata-failed' });
    expect(notifications.cancelScheduledNotification).toHaveBeenCalledWith('new-native-id');
  });
});

describe('feeding reminder permission activation', () => {
  test('serializes foreground reconciliation behind an in-flight permission activation', async () => {
    const settings = settingsRepository();
    await settings.setInterval(null, 0);
    let resolvePermission: ((permission: { status: 'granted'; canAskAgain: true }) => void) | undefined;
    let markPermissionRequested: (() => void) | undefined;
    const permissionRequested = new Promise<void>((resolve) => {
      markPermissionRequested = resolve;
    });
    const notifications = gateway([], {
      getPermission: jest.fn()
        .mockResolvedValueOnce({ status: 'denied' as const, canAskAgain: true })
        .mockResolvedValue({ status: 'granted' as const, canAskAgain: true }),
      requestPermission: jest.fn(() => new Promise((resolve) => {
        resolvePermission = resolve;
        markPermissionRequested?.();
      })),
    });
    const instance = service({ settings, gateway: notifications });
    const activation = instance.service.setInterval(120);

    await permissionRequested;
    const foregroundSync = instance.service.syncFeedingReminder();
    resolvePermission?.({ status: 'granted', canAskAgain: true });

    await expect(activation).resolves.toMatchObject({ kind: 'scheduled', intervalMinutes: 120 });
    await expect(foregroundSync).resolves.toMatchObject({ kind: 'scheduled', intervalMinutes: 120 });
  });

  test('requests permission only from an explicit enabled interval selection', async () => {
    const settings = settingsRepository();
    const notifications = gateway([], {
      getPermission: jest.fn(async () => ({ status: 'denied' as const, canAskAgain: true })),
      requestPermission: jest.fn(async () => ({ status: 'granted' as const, canAskAgain: true })),
    });
    const instance = service({ settings, gateway: notifications });
    await expect(instance.service.syncFeedingReminder()).resolves.toMatchObject({
      kind: 'permission-unavailable',
      permissionStatus: 'undetermined',
    });
    expect(notifications.requestPermission).not.toHaveBeenCalled();
    await instance.service.setInterval(120);
    expect(notifications.ensureFeedingChannel.mock.invocationCallOrder[0])
      .toBeLessThan(notifications.requestPermission.mock.invocationCallOrder[0]);
    expect(settings.markPermissionPrompted).toHaveBeenCalled();
    expect(settings.setInterval).toHaveBeenCalledWith(120, nowMs);
  });

  test('denial leaves reminders disabled and does not repeatedly request', async () => {
    const settings = settingsRepository();
    const notifications = gateway([], {
      getPermission: jest.fn(async () => ({ status: 'denied' as const, canAskAgain: true })),
      requestPermission: jest.fn(async () => ({ status: 'denied' as const, canAskAgain: true })),
    });
    const instance = service({ settings, gateway: notifications });
    await expect(instance.service.setInterval(120)).resolves.toMatchObject({ kind: 'permission-unavailable' });
    await expect(instance.service.setInterval(120)).resolves.toMatchObject({ kind: 'permission-unavailable' });
    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(settings.markPermissionPrompted).toHaveBeenCalledTimes(1);
    expect(settings.setInterval).not.toHaveBeenCalledWith(120, expect.any(Number));
  });
});

describe('development acceptance controls', () => {
  test('can create duplicate owned reminders and remove system reminders without changing settings', async () => {
    const system: ScheduledFeedingReminder[] = [];
    let sequence = 0;
    const notifications = gateway(system, {
      listFeedingReminders: jest.fn(async () => [...system]),
      scheduleFeedingReminder: jest.fn(async (input) => {
        const identifier = `native-${++sequence}`;
        system.push({ identifier, ...input });
        return identifier;
      }),
      cancelScheduledNotification: jest.fn(async (identifier) => {
        const index = system.findIndex((item) => item.identifier === identifier);
        if (index >= 0) system.splice(index, 1);
      }),
    });
    const instance = service({ gateway: notifications });

    await expect(instance.service.createDevelopmentDuplicateFeedingReminders()).resolves.toBe(2);
    expect(system).toHaveLength(2);
    await expect(instance.service.removeDevelopmentSystemFeedingReminders()).resolves.toBe(2);
    expect(system).toHaveLength(0);
  });
});

describe('notification response subscription', () => {
  test('preserves the notification gateway receiver when subscribing', () => {
    const notifications = gateway();
    notifications.subscribeToNavigationResponses = jest.fn(function subscribe(
      this: NotificationGateway,
      listener,
    ) {
      expect(this).toBe(notifications);
      expect(typeof listener).toBe('function');
      return { remove: jest.fn() };
    });
    const instance = service({ gateway: notifications });

    expect(() => instance.service.subscribeToNavigationResponses(jest.fn())).not.toThrow();
  });
});
