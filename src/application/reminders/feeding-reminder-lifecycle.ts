type ReminderSynchronizer = {
  syncFeedingReminder(options?: { forceReschedule?: boolean }): Promise<unknown>;
};

type AppStateSubscription = { remove(): void };

export function reconcileFeedingReminderOnStartup(service: ReminderSynchronizer) {
  return service.syncFeedingReminder({ forceReschedule: true });
}

export function subscribeToFeedingReminderForeground(
  service: ReminderSynchronizer,
  addChangeListener: (listener: (state: string) => void) => AppStateSubscription,
) {
  return addChangeListener((state) => {
    if (state === 'active') void service.syncFeedingReminder().catch(() => undefined);
  });
}
