import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { FeedingReminderStatus } from '@/application/reminders/feeding-reminder-service';

import { SettingsScreen } from './settings-screen';

const mockPush = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '7.8.9' } }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '5.6.7', nativeBuildVersion: '42' }));
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
  beforeEach(() => {
    jest.restoreAllMocks();
    mockPush.mockClear();
  });

  test('reads status on focus without enabling or requesting a reminder', async () => {
    const { screen, reminderService } = await renderScreen();

    await waitFor(() => expect(reminderService.syncFeedingReminder).toHaveBeenCalledTimes(1));
    expect(reminderService.setInterval).not.toHaveBeenCalled();
    expect(screen.getByText('提醒已关闭。')).toBeTruthy();
    expect(screen.getByText('系统通知：未请求')).toBeTruthy();
    expect(screen.getByText('提醒可能受系统权限和省电设置影响')).toBeTruthy();
    expect(screen.getByText('2小时')).toBeTruthy();
    expect(screen.getByText('3小时')).toBeTruthy();
    expect(screen.queryByText('2小时后')).toBeNull();
    expect(screen.queryByText('3小时后')).toBeNull();
    expect(screen.queryByText(/部分手机需要允许/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('查看提醒说明'));
    expect(screen.getByText(
      '本功能使用手机系统本地通知，不依赖网络。提醒时间可能受通知权限、省电策略和手机厂商后台限制影响。',
    )).toBeTruthy();
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
    expect(screen.getByText('最近喝奶：07月11日 14:30')).toBeTruthy();
    expect(screen.getByText('系统通知：已允许')).toBeTruthy();
    expect(screen.getByText('提醒已安排')).toBeTruthy();
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
    expect(screen.getByText('导出表格')).toBeTruthy();
    expect(screen.getByText('查看或分享记录，不含照片，不能恢复资料')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('导出CSV'));

    expect(mockPush).toHaveBeenCalledWith('/export/csv');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('changes persisted theme and opens complete backup and restore', async () => {
    const { screen, themeService } = await renderScreen();
    expect(screen.getByLabelText('宝宝资料')).toBeTruthy();
    expect(screen.getByText('喝奶提醒')).toBeTruthy();
    expect(screen.getByText('外观')).toBeTruthy();
    expect(screen.getByText(/无账号 · 无云同步/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('使用深色模式'));
    await waitFor(() => expect(themeService.setMode).toHaveBeenCalledWith('dark'));
    expect(screen.getByText('包含记录和照片')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('打开完整备份与恢复'));
    expect(mockPush).toHaveBeenCalledWith('/backup');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('keeps baby details read-only', async () => {
    const { screen } = await renderScreen();
    expect(screen.getByText('小宝')).toBeTruthy();
    expect(screen.getByText('出生日期 2026年6月20日')).toBeTruthy();
    expect(screen.queryByLabelText(/编辑宝宝|修改资料|更换头像/)).toBeNull();
    expect(screen.getByText('当前版本')).toBeTruthy();
    expect(screen.getByText('5.6.7 (42)')).toBeTruthy();
    expect(screen.queryByText('7.8.9')).toBeNull();
  });

  test('uses the config version when no native app version is available', async () => {
    jest.replaceProperty(Application, 'nativeApplicationVersion', null);
    const { screen } = await renderScreen();
    expect(screen.getByText('7.8.9')).toBeTruthy();
    expect(screen.queryByText('7.8.9 (42)')).toBeNull();
  });

  test('keeps the native version when its build number is unavailable', async () => {
    jest.replaceProperty(Application, 'nativeBuildVersion', null);
    const { screen } = await renderScreen();
    expect(screen.getByText('5.6.7')).toBeTruthy();
  });

  test('shows an honest fallback when neither version source is available', async () => {
    jest.replaceProperty(Application, 'nativeApplicationVersion', null);
    jest.replaceProperty(Constants, 'expoConfig', null);
    const { screen } = await renderScreen();
    expect(screen.getByText('版本信息暂不可用')).toBeTruthy();
  });

  test('keeps all reminder options disabled while saving', async () => {
    const reminderService = createReminderService();
    let resolveSave!: (status: FeedingReminderStatus) => void;
    reminderService.setInterval.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { screen } = await renderScreen(reminderService);
    await fireEvent.press(screen.getByLabelText('设置2小时提醒'));
    await fireEvent.press(screen.getByLabelText('设置3小时提醒'));
    expect(reminderService.setInterval).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('设置3小时提醒').props.accessibilityState.disabled).toBe(true);
    resolveSave(disabledStatus);
    await waitFor(() => expect(screen.getByLabelText('设置3小时提醒').props.accessibilityState.disabled).toBe(false));
  });

  test('keeps development tools inside the expanded reminder explanation', async () => {
    const { screen, reminderService } = await renderScreen();
    expect(screen.queryByLabelText('展开开发验收工具')).toBeNull();
    expect(screen.queryByLabelText('安排1分钟测试提醒')).toBeNull();
    await fireEvent.press(screen.getByLabelText('查看提醒说明'));
    expect(screen.getByLabelText('展开开发验收工具')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('展开开发验收工具'));
    await fireEvent.press(screen.getByLabelText('安排1分钟测试提醒'));
    await waitFor(() => expect(reminderService.scheduleDevelopmentTestReminder).toHaveBeenCalledTimes(1));
    expect(reminderService.setInterval).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('收起提醒说明'));
    expect(screen.queryByLabelText('安排1分钟测试提醒')).toBeNull();
    expect(screen.queryByLabelText('收起开发验收工具')).toBeNull();
  });
});
