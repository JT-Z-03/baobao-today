import type { NotificationPermissionStatus } from '@/domain/reminders/feeding-reminder-planner';

export type FeedingReminderSyncErrorCode =
  | 'cancel-failed'
  | 'schedule-failed'
  | 'metadata-failed'
  | 'reconcile-failed';

export type FeedingReminderSettings = {
  intervalMinutes: number | null;
  notificationId: string | null;
  scheduledForMs: number | null;
  sourceRecordId: string | null;
  permissionPrompted: boolean;
  syncErrorCode: FeedingReminderSyncErrorCode | null;
  updatedAtMs: number;
};

export type FeedingReminderMetadata = {
  notificationId: string;
  scheduledForMs: number;
  sourceRecordId: string;
};

export interface FeedingReminderSettingsRepository {
  get(): Promise<FeedingReminderSettings>;
  setInterval(intervalMinutes: number | null, nowMs: number): Promise<void>;
  markPermissionPrompted(nowMs: number): Promise<void>;
  saveMetadata(metadata: FeedingReminderMetadata, nowMs: number): Promise<void>;
  clearMetadata(errorCode: FeedingReminderSyncErrorCode | null, nowMs: number): Promise<void>;
  setSyncError(errorCode: FeedingReminderSyncErrorCode, nowMs: number): Promise<void>;
}

export type NotificationPermissionSnapshot = {
  status: NotificationPermissionStatus;
  canAskAgain: boolean;
};

export type ScheduledFeedingReminder = {
  identifier: string;
  sourceRecordId: string;
  scheduledForMs: number;
};

export type FeedingReminderNavigationResponse = {
  identifier: string;
  kind: 'feeding-reminder' | 'feeding-reminder-dev-test';
};

export interface NotificationGateway {
  ensureFeedingChannel(): Promise<void>;
  getPermission(): Promise<NotificationPermissionSnapshot>;
  requestPermission(): Promise<NotificationPermissionSnapshot>;
  listFeedingReminders(): Promise<ScheduledFeedingReminder[]>;
  scheduleFeedingReminder(input: Omit<ScheduledFeedingReminder, 'identifier'>): Promise<string>;
  cancelScheduledNotification(identifier: string): Promise<void>;
  openSystemSettings(): Promise<void>;
  scheduleDevelopmentTestReminder(scheduledForMs: number): Promise<string>;
  cancelDevelopmentTestReminders(): Promise<void>;
  getLastNavigationResponse(): Promise<FeedingReminderNavigationResponse | null>;
  subscribeToNavigationResponses(
    listener: (response: FeedingReminderNavigationResponse) => void,
  ): { remove(): void };
  clearLastNavigationResponse(): Promise<void>;
}
