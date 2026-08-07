type ReminderSynchronizer = {
  syncFeedingReminder(options?: { forceReschedule?: boolean }): Promise<unknown>;
};

type AppStateSubscription = { remove(): void };

export type FeedingReminderInitializationReason = 'cold-start' | 'restore-refresh' | 'retry';

export function reconcileFeedingReminderOnStartup(
  service: ReminderSynchronizer,
  reason: FeedingReminderInitializationReason = 'cold-start',
) {
  return service.syncFeedingReminder({ forceReschedule: reason !== 'restore-refresh' });
}

export function subscribeToFeedingReminderForeground(
  service: ReminderSynchronizer,
  addChangeListener: (listener: (state: string) => void) => AppStateSubscription,
) {
  return addChangeListener((state) => {
    if (state === 'active') void service.syncFeedingReminder().catch(() => undefined);
  });
}
