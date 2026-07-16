import { getLocalDayBounds } from '@/domain/date/local-date';
import { differenceInCalendarDates } from '@/domain/date/calendar-date';

export interface BabyProfileInput {
  name: string;
  birthDate: string;
}

export type BabyProfileValidationError = {
  field: 'name' | 'birthDate';
  message: string;
};

export function calculateBirthDayNumber(birthDate: string, todayDate: string) {
  return differenceInCalendarDates(birthDate, todayDate) + 1;
}

export function validateBabyProfile(
  input: BabyProfileInput,
  todayDate: string,
): BabyProfileValidationError | null {
  const name = input.name.trim();
  if (!name) {
    return { field: 'name', message: '请输入宝宝昵称' };
  }
  if ([...name].length > 20) {
    return { field: 'name', message: '宝宝昵称不能超过20个字符' };
  }

  try {
    getLocalDayBounds(input.birthDate);
  } catch {
    return { field: 'birthDate', message: '请选择有效的出生日期' };
  }

  if (input.birthDate > todayDate) {
    return { field: 'birthDate', message: '出生日期不能晚于今天' };
  }
  return null;
}
