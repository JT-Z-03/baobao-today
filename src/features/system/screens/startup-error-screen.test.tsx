import { fireEvent, render } from '@testing-library/react-native';

import { StartupErrorScreen } from './startup-error-screen';
import StartupRoute from '@/app/index';
import { useAppState } from '@/application/app-state/app-state-provider';

jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('expo-router', () => ({ Redirect: () => null }));

test('shows a safe startup error and a clear retry action', async () => {
  const onRetry = jest.fn();
  const screen = await render(<StartupErrorScreen message="SQLite failed at /data/user/0/app.db" onRetry={onRetry} />);

  expect(screen.getByText('本地数据暂时无法打开，请重试。')).toBeTruthy();
  expect(screen.queryByText(/SQLite|\/data\//)).toBeNull();
  fireEvent.press(screen.getByLabelText('重试打开本地数据'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('an actual startup error route keeps a committed restore warning and its separate retry visible', async () => {
  const retryInitialization = jest.fn();
  const retryPostRestore = jest.fn(async () => undefined);
  const result = { warnings: ['app-refresh'], busy: false };
  jest.mocked(useAppState).mockReturnValue({ status: 'error', errorMessage: 'initialization failure', retryInitialization,
    restoreService: { getResult: () => result, subscribeResult: () => () => undefined, retryPostRestore, acknowledgeResult: jest.fn() },
  } as never);
  const screen = await render(<StartupRoute />);
  expect(screen.getByText('数据已恢复，以下事项尚未完成')).toBeTruthy();
  expect(screen.getByText('页面资料尚未刷新。')).toBeTruthy();
  expect(screen.queryByText('恢复失败')).toBeNull();
  await fireEvent.press(screen.getByLabelText('重试后续处理'));
  expect(retryPostRestore).toHaveBeenCalledTimes(1);
  expect(retryInitialization).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('重试打开本地数据'));
  expect(retryInitialization).toHaveBeenCalledTimes(1);
});
