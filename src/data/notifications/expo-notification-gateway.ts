import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import type {
  FeedingReminderNavigationResponse,
  NotificationGateway,
  NotificationPermissionSnapshot,
  ScheduledFeedingReminder,
} from '@/application/ports/feeding-reminder';
import {
  FEEDING_REMINDER_BODY,
  FEEDING_REMINDER_TITLE,
} from '@/domain/reminders/feeding-reminder-planner';

export const FEEDING_REMINDER_CHANNEL_ID = 'feeding-reminders';

const OWNER = 'baobao-today';
const FEEDING_KIND = 'feeding-reminder';
const DEVELOPMENT_KIND = 'feeding-reminder-dev-test';

type NativePermission = {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status: number };
};

type NativeRequest = {
  identifier: string;
  content: { data?: Record<string, unknown> };
  trigger: unknown;
};

type NativeResponse = {
  notification: { request: NativeRequest };
};

export interface ExpoNotificationsApi {
  getPermissionsAsync(): Promise<NativePermission>;
  requestPermissionsAsync(input?: unknown): Promise<NativePermission>;
  setNotificationChannelAsync(channelId: string, input: unknown): Promise<unknown>;
  getAllScheduledNotificationsAsync(): Promise<NativeRequest[]>;
  scheduleNotificationAsync(input: unknown): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  getLastNotificationResponse(): NativeResponse | null;
  addNotificationResponseReceivedListener(
    listener: (response: NativeResponse) => void,
  ): { remove(): void };
  clearLastNotificationResponseAsync(): Promise<void>;
  setNotificationHandler(handler: {
    handleNotification(): Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }): void;
}

function mapPermission(
  permission: NativePermission,
  platform: string | undefined,
): NotificationPermissionSnapshot {
  if (platform === 'ios' && permission.ios) {
    const status = permission.ios.status;
    if (
      status === Notifications.IosAuthorizationStatus.AUTHORIZED
      || status === Notifications.IosAuthorizationStatus.PROVISIONAL
      || status === Notifications.IosAuthorizationStatus.EPHEMERAL
    ) {
      return { status: 'granted', canAskAgain: permission.canAskAgain };
    }
    if (status === Notifications.IosAuthorizationStatus.DENIED) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }
    return { status: 'undetermined', canAskAgain: permission.canAskAgain };
  }

  if (permission.granted || permission.status === 'granted') {
    return { status: 'granted', canAskAgain: permission.canAskAgain };
  }
  if (permission.status === 'denied') {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }
  return { status: 'undetermined', canAskAgain: permission.canAskAgain };
}

function getData(request: NativeRequest) {
  return request.content.data ?? {};
}

function mapFeedingReminder(request: NativeRequest): ScheduledFeedingReminder | null {
  const data = getData(request);
  if (data.owner !== OWNER || data.kind !== FEEDING_KIND) return null;
  if (typeof data.sourceRecordId !== 'string' || data.sourceRecordId.length === 0) return null;
  if (typeof data.scheduledForMs !== 'number' || !Number.isFinite(data.scheduledForMs)) return null;
  return {
    identifier: request.identifier,
    sourceRecordId: data.sourceRecordId,
    scheduledForMs: data.scheduledForMs,
  };
}

function mapNavigationResponse(response: NativeResponse | null): FeedingReminderNavigationResponse | null {
  if (!response) return null;
  const request = response.notification.request;
  const data = getData(request);
  if (data.owner !== OWNER || (data.kind !== FEEDING_KIND && data.kind !== DEVELOPMENT_KIND)) {
    return null;
  }
  return { identifier: request.identifier, kind: data.kind };
}

export function installForegroundNotificationHandler(
  api: ExpoNotificationsApi = Notifications as unknown as ExpoNotificationsApi,
) {
  api.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export class ExpoNotificationGateway implements NotificationGateway {
  constructor(
    private readonly api: ExpoNotificationsApi = Notifications as unknown as ExpoNotificationsApi,
    private readonly openSettings: () => Promise<void> = Linking.openSettings,
    private readonly platform: string | undefined = process.env.EXPO_OS,
  ) {}

  async ensureFeedingChannel() {
    if (this.platform !== 'android') return;
    await this.api.setNotificationChannelAsync(FEEDING_REMINDER_CHANNEL_ID, {
      name: '喝奶记录提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  async getPermission() {
    return mapPermission(await this.api.getPermissionsAsync(), this.platform);
  }

  async requestPermission() {
    const permission = await this.api.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return mapPermission(permission, this.platform);
  }

  async listFeedingReminders() {
    const requests = await this.api.getAllScheduledNotificationsAsync();
    return requests.map(mapFeedingReminder).filter((item): item is ScheduledFeedingReminder => item !== null);
  }

  scheduleFeedingReminder(input: Omit<ScheduledFeedingReminder, 'identifier'>) {
    return this.api.scheduleNotificationAsync({
      content: {
        title: FEEDING_REMINDER_TITLE,
        body: FEEDING_REMINDER_BODY,
        sound: 'default',
        data: {
          owner: OWNER,
          kind: FEEDING_KIND,
          sourceRecordId: input.sourceRecordId,
          scheduledForMs: input.scheduledForMs,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: input.scheduledForMs,
        channelId: FEEDING_REMINDER_CHANNEL_ID,
      },
    });
  }

  cancelScheduledNotification(identifier: string) {
    return this.api.cancelScheduledNotificationAsync(identifier);
  }

  openSystemSettings() {
    return this.openSettings();
  }

  scheduleDevelopmentTestReminder(scheduledForMs: number) {
    return this.api.scheduleNotificationAsync({
      content: {
        title: '喝奶记录提醒（测试）',
        body: FEEDING_REMINDER_BODY,
        sound: 'default',
        data: { owner: OWNER, kind: DEVELOPMENT_KIND, scheduledForMs },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: scheduledForMs,
        channelId: FEEDING_REMINDER_CHANNEL_ID,
      },
    });
  }

  async cancelDevelopmentTestReminders() {
    const requests = await this.api.getAllScheduledNotificationsAsync();
    for (const request of requests) {
      const data = getData(request);
      if (data.owner === OWNER && data.kind === DEVELOPMENT_KIND) {
        await this.api.cancelScheduledNotificationAsync(request.identifier);
      }
    }
  }

  async getLastNavigationResponse() {
    return mapNavigationResponse(this.api.getLastNotificationResponse());
  }

  subscribeToNavigationResponses(listener: (response: FeedingReminderNavigationResponse) => void) {
    return this.api.addNotificationResponseReceivedListener((nativeResponse) => {
      const response = mapNavigationResponse(nativeResponse);
      if (response) listener(response);
    });
  }

  clearLastNavigationResponse() {
    return this.api.clearLastNotificationResponseAsync();
  }
}
