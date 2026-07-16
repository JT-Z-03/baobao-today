import {
  formatReminderTime,
  getReminderStatusMessage,
  parseCustomReminderInterval,
} from './feeding-reminder-settings';

describe('feeding reminder settings presentation', () => {
  test.each([
    ['0', '15', 15],
    ['2', '0', 120],
    ['23', '59', 1439],
    ['24', '0', 1440],
  ])('converts %s hours %s minutes to integer minutes', (hours, minutes, expected) => {
    expect(parseCustomReminderInterval(hours, minutes)).toEqual({ ok: true, intervalMinutes: expected });
  });

  test.each([
    ['', '', '请输入提醒间隔。'],
    ['0', '14', '提醒间隔最少为15分钟。'],
    ['24', '1', '提醒间隔最多为24小时。'],
    ['1.5', '0', '小时和分钟必须是非负整数。'],
    ['1', '60', '分钟请输入0到59之间的整数。'],
  ])('returns a Chinese validation message for invalid custom input', (hours, minutes, message) => {
    expect(parseCustomReminderInterval(hours, minutes)).toEqual({ ok: false, message });
  });

  test('formats a local reminder time without exposing technical metadata', () => {
    const time = new Date(2026, 6, 11, 16, 30).getTime();
    expect(formatReminderTime(time)).toBe('07月11日 16:30');
  });

  test.each([
    ['waiting-record', '记录下一次喝奶后，系统会自动安排提醒。'],
    ['expired', '根据最近一次喝奶记录计算的提醒时间已经过去。下次记录喝奶后会重新安排。'],
    ['permission-unavailable', '通知权限未开启，无法发送提醒。你仍然可以正常使用所有记录功能。'],
    ['sync-error', '提醒更新失败，请重新同步。'],
    ['disabled', '提醒已关闭。'],
    ['scheduled', '提醒已安排'],
  ] as const)('maps %s to a product-facing status', (kind, message) => {
    expect(getReminderStatusMessage(kind)).toBe(message);
  });
});
