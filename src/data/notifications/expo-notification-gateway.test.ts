import {
  ExpoNotificationGateway,
  FEEDING_REMINDER_CHANNEL_ID,
  installForegroundNotificationHandler,
  type ExpoNotificationsApi,
} from './expo-notification-gateway';

function createApi(overrides: Record<string, unknown> = {}) {
  return {
    getPermissionsAsync: jest.fn().mockResolvedValue({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: false,
    }),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
    getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
    scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-1'),
    cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    getLastNotificationResponse: jest.fn().mockReturnValue(null),
    addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationHandler: jest.fn(),
    ...overrides,
  } as unknown as ExpoNotificationsApi & Record<string, jest.Mock>;
}

function request(identifier: string, data: Record<string, unknown>) {
  return {
    identifier,
    content: { data },
    trigger: null,
  };
}

function response(identifier: string, data: Record<string, unknown>) {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: { date: 0, request: request(identifier, data) },
  };
}

describe('ExpoNotificationGateway', () => {
  test.each([
    ['granted', { status: 'granted', granted: true, canAskAgain: false }, 'granted'],
    ['denied', { status: 'denied', granted: false, canAskAgain: false }, 'denied'],
    ['undetermined', { status: 'undetermined', granted: false, canAskAgain: true }, 'undetermined'],
  ])('maps Android %s permission', async (_name, nativeStatus, expected) => {
    const api = createApi({ getPermissionsAsync: jest.fn().mockResolvedValue(nativeStatus) });
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'android');

    await expect(gateway.getPermission()).resolves.toEqual({
      status: expected,
      canAskAgain: nativeStatus.canAskAgain,
    });
  });

  test.each([
    [2, 'granted'],
    [3, 'granted'],
    [4, 'granted'],
    [1, 'denied'],
    [0, 'undetermined'],
  ])('maps iOS authorization status %s to %s', async (iosStatus, expected) => {
    const api = createApi({
      getPermissionsAsync: jest.fn().mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: iosStatus === 0,
        ios: { status: iosStatus },
      }),
    });
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'ios');

    await expect(gateway.getPermission()).resolves.toMatchObject({ status: expected });
  });

  test('creates the Android channel with default importance and implicit system sound', async () => {
    const api = createApi();
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'android');

    await gateway.ensureFeedingChannel();

    expect(api.setNotificationChannelAsync).toHaveBeenCalledWith(
      FEEDING_REMINDER_CHANNEL_ID,
      { name: '喝奶记录提醒', importance: 5 },
    );
  });

  test('lists only valid app-owned feeding reminders', async () => {
    const api = createApi({
      getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([
        request('valid', {
          owner: 'baobao-today',
          kind: 'feeding-reminder',
          sourceRecordId: 'feeding-1',
          scheduledForMs: 123456,
        }),
        request('other-app-data', {
          owner: 'someone-else',
          kind: 'feeding-reminder',
          sourceRecordId: 'feeding-2',
          scheduledForMs: 123456,
        }),
        request('dev-test', { owner: 'baobao-today', kind: 'feeding-reminder-dev-test' }),
        request('invalid', { owner: 'baobao-today', kind: 'feeding-reminder' }),
      ]),
    });
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'android');

    await expect(gateway.listFeedingReminders()).resolves.toEqual([{
      identifier: 'valid',
      sourceRecordId: 'feeding-1',
      scheduledForMs: 123456,
    }]);
  });

  test('schedules a one-off dated local notification with ownership metadata', async () => {
    const api = createApi();
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'android');

    await expect(gateway.scheduleFeedingReminder({
      sourceRecordId: 'feeding-1',
      scheduledForMs: 123456,
    })).resolves.toBe('notification-1');

    expect(api.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: '喝奶记录提醒',
        body: '你设置的喝奶记录提醒到了。',
        sound: 'default',
        data: {
          owner: 'baobao-today',
          kind: 'feeding-reminder',
          sourceRecordId: 'feeding-1',
          scheduledForMs: 123456,
        },
      },
      trigger: {
        type: 'date',
        date: 123456,
        channelId: FEEDING_REMINDER_CHANNEL_ID,
      },
    });
  });

  test('recognizes only owned reminder navigation responses', async () => {
    const api = createApi({
      getLastNotificationResponse: jest.fn().mockReturnValue(response('response-1', {
        owner: 'baobao-today',
        kind: 'feeding-reminder',
      })),
    });
    const gateway = new ExpoNotificationGateway(api, jest.fn(), 'android');

    await expect(gateway.getLastNavigationResponse()).resolves.toEqual({
      identifier: 'response-1',
      kind: 'feeding-reminder',
    });
  });

  test('installs a foreground handler that shows the reminder without a badge', async () => {
    const api = createApi();
    installForegroundNotificationHandler(api);
    const handler = (api.setNotificationHandler as jest.Mock).mock.calls[0][0];

    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});
