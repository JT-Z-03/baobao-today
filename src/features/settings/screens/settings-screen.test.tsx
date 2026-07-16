import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { FeedingReminderStatus } from '@/application/reminders/feeding-reminder-service';

import { SettingsScreen } from './settings-screen';

const mockPush = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    useRouter: () => ({ push: mockPush }),
  };
});

const disabledStatus: FeedingReminderStatus = {
  kind: 'disabled' as const,
  intervalMinutes: null,
  permissionStatus: 'undetermined' as const,
  latestFeedingEventTimeMs: null,
  syncErrorCode: null,
};

function createReminderService(status: FeedingReminderStatus = disabledStatus) {
  return {
    syncFeedingReminder: jest.fn(async () => status),
    setInterval: jest.fn(async () => status),
    openSystemSettings: jest.fn(async () => undefined),
    scheduleDevelopmentTestReminder: jest.fn(async () => 'dev-id'),
    cancelDevelopmentTestReminders: jest.fn(async () => undefined),
  };
}

async function renderScreen(reminderService = createReminderService()) {
  const themeService = { setMode: jest.fn(async (mode: string) => mode) };
  (useAppState as jest.Mock).mockReturnValue({
    babyProfile: { id: 'baby-1', name: '小宝', birthDate: '2026-06-20' },
    feedingReminderService: reminderService,
    themeMode: 'system',
    themeService,
  });
  return { screen: await render(<SettingsScreen />), reminderService, themeService };
}

describe('SettingsScreen feeding reminders', () => {
  beforeEach(() => mockPush.mockClear());

  test('reads status on focus without enabling or requesting a reminder', async () => {
    const { screen, reminderService } = await renderScreen();

    await waitFor(() => expect(reminderService.syncFeedingReminder).toHaveBeenCalledTimes(1));
    expect(reminderService.setInterval).not.toHaveBeenCalled();
    expect(screen.getByText('提醒已关闭。')).toBeTruthy();
    expect(screen.getByText('系统通知：未请求')).toBeTruthy();
    expect(screen.getByText(
      '本功能使用手机系统本地通知，不依赖网络。提醒时间可能受通知权限、省电策略和手机厂商后台限制影响。',
    )).toBeTruthy();
    expect(screen.queryByText(/部分手机需要允许/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('查看提醒说明'));
    expect(screen.getByText(/部分手机需要允许/)).toBeTruthy();
  });

  test('enables a two-hour reminder only after the user presses the option', async () => {
    const scheduled = {
      ...disabledStatus,
      kind: 'scheduled' as const,
      intervalMinutes: 120,
      permissionStatus: 'granted' as const,
      latestFeedingEventTimeMs: new Date(2026, 6, 11, 14, 30).getTime(),
      sourceRecordId: 'feeding-1',
      sourceEventTimeMs: new Date(2026, 6, 11, 14, 30).getTime(),
      scheduledForMs: new Date(2026, 6, 11, 16, 30).getTime(),
    };
    const reminderService = createReminderService();
    reminderService.setInterval.mockResolvedValue(scheduled);
    const { screen } = await renderScreen(reminderService);

    await fireEvent.press(screen.getByLabelText('设置2小时提醒'));

    await waitFor(() => expect(reminderService.setInterval).toHaveBeenCalledWith(120));
    expect(screen.getByText('下次提醒：07月11日 16:30')).toBeTruthy();
  });

  test('validates custom interval before calling the reminder service', async () => {
    const { screen, reminderService } = await renderScreen();
    await fireEvent.press(screen.getByLabelText('选择自定义提醒'));
    await waitFor(() => expect(screen.getByLabelText('自定义小时')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('自定义小时'), '0');
    await fireEvent.changeText(screen.getByLabelText('自定义分钟'), '10');
    await fireEvent.press(screen.getByLabelText('启用自定义提醒'));

    await waitFor(() => expect(screen.getByText('提醒间隔最少为15分钟。')).toBeTruthy());
    expect(reminderService.setInterval).not.toHaveBeenCalled();
  });

  test('shows permission denial without exposing a notification identifier', async () => {
    const deniedStatus = {
      ...disabledStatus,
      kind: 'permission-unavailable' as const,
      permissionStatus: 'denied' as const,
    };
    const reminderService = createReminderService(deniedStatus);
    const { screen } = await renderScreen(reminderService);

    await waitFor(() => expect(reminderService.syncFeedingReminder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(
      '通知权限未开启，无法发送提醒。你仍然可以正常使用所有记录功能。',
    )).toBeTruthy());
    expect(screen.getByLabelText('打开系统通知设置')).toBeTruthy();
    expect(screen.queryByText(/notification-/)).toBeNull();
  });

  test('opens CSV data export with clear photo limitations', async () => {
    const { screen } = await renderScreen();
    expect(screen.getByText('数据管理')).toBeTruthy();
    expect(screen.getByText('CSV 数据导出')).toBeTruthy();
    expect(screen.getByText('将宝宝资料和记录导出为CSV表格。照片不会包含在CSV中。')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('导出CSV'));

    expect(mockPush).toHaveBeenCalledWith('/export/csv');
  });

  test('changes persisted theme and opens complete backup and restore', async () => {
    const { screen, themeService } = await renderScreen();
    expect(screen.getByText('宝宝资料')).toBeTruthy();
    expect(screen.getByText('提醒')).toBeTruthy();
    expect(screen.getByText('外观')).toBeTruthy();
    expect(screen.getByText('关于和说明')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('使用深色模式'));
    await waitFor(() => expect(themeService.setMode).toHaveBeenCalledWith('dark'));
    expect(screen.getByText(/完整备份包含宝宝资料、全部记录和大便照片/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('打开完整备份与恢复'));
    expect(mockPush).toHaveBeenCalledWith('/backup');
  });
});
