export const FEEDING_REMINDER_TITLE = '喝奶记录提醒';
export const FEEDING_REMINDER_BODY = '你设置的喝奶记录提醒到了。';
export const FEEDING_REMINDER_MIN_INTERVAL_MINUTES = 15;
export const FEEDING_REMINDER_MAX_INTERVAL_MINUTES = 24 * 60;

export type NotificationPermissionStatus = 'undetermined' | 'granted' | 'denied';

export type LatestFeedingForReminder = {
  id: string;
  eventTimeMs: number;
  createdAtMs?: number;
};

export type FeedingReminderPlan =
  | { kind: 'disabled' }
  | { kind: 'permission-unavailable'; permissionStatus: Exclude<NotificationPermissionStatus, 'granted'> }
  | { kind: 'waiting-record' }
  | { kind: 'expired'; sourceRecordId: string; scheduledForMs: number }
  | {
      kind: 'scheduled';
      intervalMinutes: number;
      sourceRecordId: string;
      sourceEventTimeMs: number;
      scheduledForMs: number;
    };

export class FeedingReminderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedingReminderValidationError';
  }
}

export function validateFeedingReminderInterval(intervalMinutes: number) {
  if (!Number.isSafeInteger(intervalMinutes)
    || intervalMinutes < FEEDING_REMINDER_MIN_INTERVAL_MINUTES
    || intervalMinutes > FEEDING_REMINDER_MAX_INTERVAL_MINUTES) {
    throw new FeedingReminderValidationError('提醒间隔必须是15至1440之间的整数分钟');
  }
  return intervalMinutes;
}

export function planFeedingReminder(input: {
  intervalMinutes: number | null;
  permissionStatus: NotificationPermissionStatus;
  latestFeeding: LatestFeedingForReminder | null;
  nowMs: number;
}): FeedingReminderPlan {
  if (input.intervalMinutes === null) return { kind: 'disabled' };
  const intervalMinutes = validateFeedingReminderInterval(input.intervalMinutes);
  if (input.permissionStatus !== 'granted') {
    return { kind: 'permission-unavailable', permissionStatus: input.permissionStatus };
  }
  if (!input.latestFeeding) return { kind: 'waiting-record' };
  const scheduledForMs = input.latestFeeding.eventTimeMs + intervalMinutes * 60_000;
  if (scheduledForMs <= input.nowMs) {
    return { kind: 'expired', sourceRecordId: input.latestFeeding.id, scheduledForMs };
  }
  return {
    kind: 'scheduled',
    intervalMinutes,
    sourceRecordId: input.latestFeeding.id,
    sourceEventTimeMs: input.latestFeeding.eventTimeMs,
    scheduledForMs,
  };
}
