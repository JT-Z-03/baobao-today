import { parseLocalDateKey } from '@/domain/date/local-date';

function toGregorianDayOrdinal(dateKey: string) {
  const date = parseLocalDateKey(dateKey);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const adjustedYear = date.getFullYear() - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

export function differenceInCalendarDates(fromDate: string, toDate: string) {
  return toGregorianDayOrdinal(toDate) - toGregorianDayOrdinal(fromDate);
}
