export type LocalDateKey = `${number}-${number}-${number}`;

function padTwoDigits(value: number) {
  return value.toString().padStart(2, '0');
}

export function toLocalDateKey(timestampMs: number): LocalDateKey {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}` as LocalDateKey;
}

export function parseLocalDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid local date: ${dateKey}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);

  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    throw new Error(`Invalid local date: ${dateKey}`);
  }

  return date;
}

export function getLocalDayBounds(dateKey: string) {
  const start = parseLocalDateKey(dateKey);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function shiftLocalDateKey(dateKey: string, days: number) {
  const date = parseLocalDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date.getTime());
}
