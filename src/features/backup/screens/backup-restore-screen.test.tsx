import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { BackupRestoreScreen } from './backup-restore-screen';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
const mockPreventRemove = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => mockPreventRemove(prevent, callback),
}));

const summary = {
  backupCreatedAtMs: new Date(2026, 6, 12, 12, 0).getTime(), appVersion: '1.0.0',
  babyName: '小宝', babyBirthDate: '2026-06-01', feedingCount: 1, poopCount: 2, peeCount: 3,
  sleepCount: 4, otherCount: 5, photoCount: 2, hasActiveSleep: true, themeMode: 'dark' as const,
  reminderEnabled: true, reminderIntervalMinutes: 120, archiveBytes: 1024,
};

async function setup() {
  const prepared = { summary };
  let resolveCreate!: (value: { filename: string; uri: string }) => void;
  const createResult = new Promise<{ filename: string; uri: string }>((resolve) => { resolveCreate = resolve; });
  const backupService = { createAndShare: jest.fn(() => createResult) };
  const restoreService = {
    hasUndo: jest.fn(async () => true),
    pickAndPrepare: jest.fn(async () => prepared),
    prepareUndo: jest.fn(async () => prepared),
    confirmPrepared: jest.fn(async () => ({ committed: true, warnings: [] })),
    cancelPrepared: jest.fn(async () => undefined),
  };
  (useAppState as jest.Mock).mockReturnValue({ backupService, restoreService });
  return { screen: await render(<BackupRestoreScreen />), backupService, restoreService, resolveCreate };
}

describe('BackupRestoreScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPreventRemove.mockClear();
  });

  test('shows privacy, replacement, CSV distinction, and undo controls', async () => {
    const { screen } = await setup();
    expect(screen.getByText(/当前备份文件未加密/)).toBeTruthy();
    expect(screen.getByText(/CSV用于查看和分享/)).toBeTruthy();
    expect(screen.getByText(/恢复会替换当前宝宝资料/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('撤销上次恢复')).toBeTruthy());
  });

  test('guards rapid create taps and opens one backup/share flow', async () => {
    const { screen, backupService, resolveCreate } = await setup();
    await fireEvent.press(screen.getByLabelText('创建完整备份'));
    await fireEvent.press(screen.getByLabelText('创建完整备份'));
    expect(screen.getByText('备份文件包含宝宝的私密数据')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('继续创建'));
    await waitFor(() => expect(backupService.createAndShare).toHaveBeenCalledTimes(1));
    resolveCreate({ filename: 'backup.zip', uri: 'cache/backup.zip' });
    await waitFor(() => expect(screen.getByText(/系统分享面板已关闭/)).toBeTruthy());
    expect(screen.getByText(/系统分享面板已关闭/)).toBeTruthy();
  });

  test('shows validated restore summary before replacement confirmation', async () => {
    const { screen, restoreService } = await setup();
    await fireEvent.press(screen.getByLabelText('从备份文件恢复'));
    await waitFor(() => expect(screen.getByText('恢复预览')).toBeTruthy());
    expect(screen.getByText('小宝')).toBeTruthy();
    expect(screen.getByText('喝奶 1 · 大便 2 · 小便 3')).toBeTruthy();
    expect(screen.getByText(/替换，不会合并/)).toBeTruthy();
    expect(restoreService.confirmPrepared).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('确认恢复'));
    expect(screen.getByText('确认替换当前数据')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('替换并恢复'));
    await waitFor(() => expect(restoreService.confirmPrepared).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/today');
  });

  test('prepares undo through the same summary and confirmation flow', async () => {
    const { screen, restoreService } = await setup();
    await waitFor(() => screen.getByLabelText('撤销上次恢复'));
    await fireEvent.press(screen.getByLabelText('撤销上次恢复'));
    await waitFor(() => expect(restoreService.prepareUndo).toHaveBeenCalled());
    expect(screen.getByLabelText('确认撤销恢复')).toBeTruthy();
  });

  test('prevents navigation during a backup and releases the guard after it finishes', async () => {
    const { screen, resolveCreate } = await setup();
    await fireEvent.press(screen.getByLabelText('创建完整备份'));
    await fireEvent.press(screen.getByLabelText('继续创建'));
    await waitFor(() => expect(mockPreventRemove.mock.lastCall[0]).toBe(true));
    expect(screen.getByLabelText('从备份文件恢复').props.accessibilityState.disabled).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
    resolveCreate({ filename: 'backup.zip', uri: 'cache/backup.zip' });
    await waitFor(() => expect(mockPreventRemove.mock.lastCall[0]).toBe(false));
    expect(screen.getByLabelText('从备份文件恢复').props.accessibilityState.disabled).toBe(false);
  });

  test('canceling replacement confirmation does not restore any data', async () => {
    const { screen, restoreService } = await setup();
    await fireEvent.press(screen.getByLabelText('从备份文件恢复'));
    await waitFor(() => expect(screen.getByLabelText('确认恢复')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('确认恢复'));
    await fireEvent.press(screen.getByLabelText('取消'));
    expect(restoreService.confirmPrepared).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText('恢复预览')).toBeTruthy();
  });
});
