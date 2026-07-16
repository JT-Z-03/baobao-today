import {
  FEEDING_REMINDER_MAX_INTERVAL_MINUTES,
  FEEDING_REMINDER_MIN_INTERVAL_MINUTES,
} from '@/domain/reminders/feeding-reminder-planner';

export type CustomReminderIntervalResult =
  | { ok: true; intervalMinutes: number }
  | { ok: false; message: string };

function parseNonNegativeInteger(value: string) {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function parseCustomReminderInterval(
  hoursText: string,
  minutesText: string,
): CustomReminderIntervalResult {
  if (hoursText.trim() === '' && minutesText.trim() === '') {
    return { ok: false, message: '请输入提醒间隔。' };
  }
  const hours = parseNonNegativeInteger(hoursText);
  const minutes = parseNonNegativeInteger(minutesText);
  if (hours === null || minutes === null) {
    return { ok: false, message: '小时和分钟必须是非负整数。' };
  }
  if (minutes > 59) {
    return { ok: false, message: '分钟请输入0到59之间的整数。' };
  }
  const intervalMinutes = hours * 60 + minutes;
  if (intervalMinutes < FEEDING_REMINDER_MIN_INTERVAL_MINUTES) {
    return { ok: false, message: '提醒间隔最少为15分钟。' };
  }
  if (intervalMinutes > FEEDING_REMINDER_MAX_INTERVAL_MINUTES) {
    return { ok: false, message: '提醒间隔最多为24小时。' };
  }
  return { ok: true, intervalMinutes };
}

export function formatReminderTime(timestampMs: number) {
  const date = new Date(timestampMs);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getReminderStatusMessage(kind: string) {
  switch (kind) {
    case 'waiting-record':
      return '记录下一次喝奶后，系统会自动安排提醒。';
    case 'expired':
      return '根据最近一次喝奶记录计算的提醒时间已经过去。下次记录喝奶后会重新安排。';
    case 'permission-unavailable':
      return '通知权限未开启，无法发送提醒。你仍然可以正常使用所有记录功能。';
    case 'sync-error':
      return '提醒更新失败，请重新同步。';
    case 'disabled':
      return '提醒已关闭。';
    case 'scheduled':
      return '提醒已安排';
    default:
      return '正在读取提醒状态。';
  }
}
