import { fireEvent, render } from '@testing-library/react-native';

import { StartupErrorScreen } from './startup-error-screen';

jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));

test('shows a safe startup error and a clear retry action', async () => {
  const onRetry = jest.fn();
  const screen = await render(<StartupErrorScreen message="SQLite failed at /data/user/0/app.db" onRetry={onRetry} />);

  expect(screen.getByText('本地数据暂时无法打开，请重试。')).toBeTruthy();
  expect(screen.queryByText(/SQLite|\/data\//)).toBeNull();
  fireEvent.press(screen.getByLabelText('重试打开本地数据'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
