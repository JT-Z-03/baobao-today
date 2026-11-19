import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { BackupRestoreScreen } from './backup-restore-screen';
import type { RestoreResult, RestoreWarning } from '@/application/backup/restore-service';
import type { BackupProgressObserver } from '@/application/ports/backup';

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

async function setup(warnings: RestoreWarning[] = []) {
  const prepared = { summary };
  let resolveCreate!: (value: { filename: string; uri: string }) => void;
  const createResult = new Promise<{ filename: string; uri: string }>((resolve) => { resolveCreate = resolve; });
  const backupService = { createAndShare: jest.fn((_observer?: BackupProgressObserver) => createResult) };
  let receipt: RestoreResult | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const restoreService = {
    hasUndo: jest.fn(async () => true),
    pickAndPrepare: jest.fn(async (_observer?: BackupProgressObserver) => prepared),
    prepareUndo: jest.fn(async (_observer?: BackupProgressObserver) => prepared),
    confirmPrepared: jest.fn(async (_observer?: BackupProgressObserver) => {
      if (warnings.length) { receipt = { warnings, busy: false }; notify(); }
      return { committed: true, warnings };
    }),
    getResult: () => receipt,
    subscribeResult: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    acknowledgeResult: jest.fn(() => { receipt = null; notify(); }),
    retryPostRestore: jest.fn(async () => { receipt = { warnings: [], busy: false }; notify(); }),
    cancelPrepared: jest.fn(async () => undefined),
  };
  (useAppState as jest.Mock).mockReturnValue({ backupService, restoreService });
  return { screen: await render(<BackupRestoreScreen />), backupService, restoreService, resolveCreate };
}

describe('BackupRestoreScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['draft-state', '未完成记录状态尚未整理，请重试后再继续草稿。'],
    ['old-photo-cleanup', '旧照片尚未清理完成。'],
    ['reminder-sync', '喝奶提醒尚未同步，请重试并核对提醒设置。'],
    ['app-refresh', '页面资料尚未刷新。'],
    ['restore-workspace-cleanup', '恢复临时文件尚未清理完成。'],
  ] as const)('retains %s across screen remount until acknowledged', async (warning, message) => {
    const { screen, restoreService } = await setup([warning]);
    await fireEvent.press(screen.getByLabelText('从备份文件恢复'));
    await fireEvent.press(await screen.findByLabelText('确认恢复'));
    await fireEvent.press(screen.getByLabelText('替换并恢复'));
    await screen.findByText(message);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('确认恢复')).toBeNull();
    expect(screen.getByLabelText('从备份文件恢复').props.accessibilityState.disabled).toBe(true);
    await screen.unmount();
    const remounted = await render(<BackupRestoreScreen />);
    expect(remounted.getByText(message)).toBeTruthy();
    await fireEvent.press(remounted.getByLabelText('重试后续处理'));
    await remounted.findByText('恢复后续处理已完成');
    expect(restoreService.confirmPrepared).toHaveBeenCalledTimes(1);
    expect(restoreService.retryPostRestore).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(remounted.getByLabelText('已知晓，返回首页'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/today'));
    expect(restoreService.getResult()).toBeNull();
  });

  test('shows privacy, replacement, CSV distinction, and undo controls', async () => {
    const { screen } = await setup();
    expect(screen.getByText(/当前备份文件未加密/)).toBeTruthy();
    expect(screen.getByText(/导出表格适合查看、整理和打印，不含照片，不能恢复应用/)).toBeTruthy();
    expect(screen.getByText(/恢复会替换当前宝宝资料/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('撤销上次恢复')).toBeTruthy());
  });

  test('guards rapid create taps and opens one backup/share flow', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const { screen, backupService, resolveCreate } = await setup();
    await fireEvent.press(screen.getByLabelText('创建完整备份'));
    await fireEvent.press(screen.getByLabelText('创建完整备份'));
    expect(screen.getByText('备份文件包含宝宝的私密数据')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('继续创建'));
    await waitFor(() => expect(backupService.createAndShare).toHaveBeenCalledTimes(1));
    await act(async () => { backupService.createAndShare.mock.calls[0][0]?.({ stage: 'archive', completed: 2, total: 4, unit: 'files' }); });
    expect(screen.getByText('正在生成备份文件（2/4）').props.accessibilityLiveRegion).toBe('none');
    await act(async () => { backupService.createAndShare.mock.calls[0][0]?.({ stage: 'extract', completed: 256, total: 1024, unit: 'bytes' }); });
    expect(screen.getByText('正在解压备份（25%）').props.accessibilityLiveRegion).toBe('none');
    expect(announce.mock.calls).toEqual([['正在读取数据并处理照片']]);
    resolveCreate({ filename: 'backup.zip', uri: 'cache/backup.zip' });
    await waitFor(() => expect(screen.getByText(/系统分享面板已关闭/)).toBeTruthy());
    expect(screen.getByText(/系统分享面板已关闭/).props.accessibilityLiveRegion).toBe('polite');
  });

  test.each([
    ['pickAndPrepare', '从备份文件恢复', '正在校验备份', '确认恢复', '替换并恢复', '正在创建恢复前安全备份并恢复数据'],
    ['prepareUndo', '撤销上次恢复', '正在校验恢复前安全备份', '确认撤销恢复', '确认撤销', '正在撤销上次恢复'],
  ] as const)('keeps TalkBack progress detail available on demand during %s and confirmation', async (prepare, open, previewLabel, review, confirm, operationLabel) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const { screen, restoreService } = await setup();
    let finishPreview!: () => void;
    const previewPending = new Promise<void>((resolve) => { finishPreview = resolve; });
    restoreService[prepare].mockImplementationOnce(async () => { await previewPending; return { summary }; });
    let finishRestore!: () => void;
    const restorePending = new Promise<void>((resolve) => { finishRestore = resolve; });
    restoreService.confirmPrepared.mockImplementationOnce(async () => { await restorePending; return { committed: true, warnings: [] }; });

    await fireEvent.press(await screen.findByLabelText(open));
    const checkProgress = async (observer: BackupProgressObserver) => {
      for (const completed of [10, 50, 95]) {
        await act(() => observer({ stage: 'extract', completed, total: 100, unit: 'bytes' }));
        const detail = screen.getByText(`正在解压备份（${completed}%）`);
        expect(detail.props.accessibilityLiveRegion).toBe('none');
        expect(detail.props.accessibilityLabel).toBeUndefined();
      }
    };
    await checkProgress(restoreService[prepare].mock.calls[0][0]!);
    expect(announce.mock.calls).toEqual([[previewLabel]]);
    await act(finishPreview);
    await fireEvent.press(await screen.findByLabelText(review));
    await fireEvent.press(screen.getByLabelText(confirm));
    await checkProgress(restoreService.confirmPrepared.mock.calls[0][0]!);
    await act(finishRestore);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/today'));
    expect(announce.mock.calls).toEqual([[previewLabel], [operationLabel]]);
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
