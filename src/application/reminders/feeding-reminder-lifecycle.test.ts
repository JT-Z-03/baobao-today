import {
  reconcileFeedingReminderOnStartup,
  subscribeToFeedingReminderForeground,
} from './feeding-reminder-lifecycle';

describe('feeding reminder app lifecycle', () => {
  test('reconciles once during startup', async () => {
    const syncFeedingReminder = jest.fn(async () => ({ kind: 'disabled' }));
    await reconcileFeedingReminderOnStartup({ syncFeedingReminder });
    expect(syncFeedingReminder).toHaveBeenCalledWith({ forceReschedule: true });
  });

  test('reuses the restored reminder once, while a later retry remains forced', async () => {
    const syncFeedingReminder = jest.fn(async () => ({ kind: 'scheduled' }));

    await reconcileFeedingReminderOnStartup({ syncFeedingReminder }, 'restore-refresh');
    await reconcileFeedingReminderOnStartup({ syncFeedingReminder }, 'retry');

    expect(syncFeedingReminder).toHaveBeenNthCalledWith(1, { forceReschedule: false });
    expect(syncFeedingReminder).toHaveBeenNthCalledWith(2, { forceReschedule: true });
  });

  test('reconciles only when the app becomes active and removes the listener', async () => {
    const syncFeedingReminder = jest.fn(async () => ({ kind: 'disabled' }));
    let listener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const subscription = subscribeToFeedingReminderForeground(
      { syncFeedingReminder },
      (nextListener) => {
        listener = nextListener;
        return { remove };
      },
    );

    listener?.('background');
    listener?.('active');
    await Promise.resolve();

    expect(syncFeedingReminder).toHaveBeenCalledTimes(1);
    expect(syncFeedingReminder).toHaveBeenCalledWith();
    subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
