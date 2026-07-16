export function handleFeedingReminderNavigation(
  identifier: string,
  handledIdentifiers: Set<string>,
  navigateToday: () => void,
) {
  if (handledIdentifiers.has(identifier)) return false;
  handledIdentifiers.add(identifier);
  navigateToday();
  return true;
}
