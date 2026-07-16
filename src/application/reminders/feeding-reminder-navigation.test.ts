import { handleFeedingReminderNavigation } from './feeding-reminder-navigation';

describe('feeding reminder navigation', () => {
  test('consumes the same cold/live notification response only once', () => {
    const handled = new Set<string>();
    const navigateToday = jest.fn();

    expect(handleFeedingReminderNavigation('notification-1', handled, navigateToday)).toBe(true);
    expect(handleFeedingReminderNavigation('notification-1', handled, navigateToday)).toBe(false);
    expect(navigateToday).toHaveBeenCalledTimes(1);
  });
});
