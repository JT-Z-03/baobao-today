import { calculateBirthDayNumber, validateBabyProfile } from './baby-profile';

describe('baby profile rules', () => {
  test('counts the birth date as day one', () => {
    expect(calculateBirthDayNumber('2026-07-10', '2026-07-10')).toBe(1);
    expect(calculateBirthDayNumber('2026-07-01', '2026-07-10')).toBe(10);
  });

  test('increments by calendar dates across month and year boundaries', () => {
    expect(calculateBirthDayNumber('2026-01-31', '2026-02-01')).toBe(2);
    expect(calculateBirthDayNumber('2025-12-31', '2026-01-01')).toBe(2);
  });

  test('does not depend on a local day containing exactly twenty-four hours', () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(calculateBirthDayNumber('2026-03-08', '2026-03-09')).toBe(2);
      expect(calculateBirthDayNumber('2026-11-01', '2026-11-02')).toBe(2);
    } finally {
      process.env.TZ = originalTimeZone;
    }
  });

  test('rejects a blank name and a future birth date', () => {
    expect(validateBabyProfile({ name: '   ', birthDate: '2026-07-10' }, '2026-07-10')).toEqual({
      field: 'name',
      message: '请输入宝宝昵称',
    });
    expect(validateBabyProfile({ name: '小宝', birthDate: '2026-07-11' }, '2026-07-10')).toEqual({
      field: 'birthDate',
      message: '出生日期不能晚于今天',
    });
  });

  test('accepts a trimmed name up to twenty characters', () => {
    expect(validateBabyProfile({ name: ' 小宝 ', birthDate: '2026-07-10' }, '2026-07-10')).toBeNull();
    expect(validateBabyProfile({ name: '宝'.repeat(21), birthDate: '2026-07-10' }, '2026-07-10')).toEqual({
      field: 'name',
      message: '宝宝昵称不能超过20个字符',
    });
  });
});
