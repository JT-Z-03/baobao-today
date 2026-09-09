import { parseLocalDateKey, toLocalDateKey, type LocalDateKey } from '@/domain/date/local-date';

/** A missing parameter preserves the user's current tab selection. */
export function resolveRecordsDateIntent(
  value: string | string[] | undefined,
  today: LocalDateKey,
): LocalDateKey | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') return today;
  try {
    const selected = toLocalDateKey(parseLocalDateKey(value).getTime());
    return selected > today ? today : selected;
  } catch {
    return today;
  }
}
