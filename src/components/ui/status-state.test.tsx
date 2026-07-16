import { fireEvent, render } from '@testing-library/react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/status-state';

test('empty, loading and error states stay understandable without color', async () => {
  const retry = jest.fn();
  const view = await render(<EmptyState message="今天还没有记录" />);
  expect(view.getByText('今天还没有记录')).toBeTruthy();

  await view.rerender(<LoadingState message="正在校验备份" />);
  expect(view.getByTestId('loading-state').props.accessibilityState.busy).toBe(true);

  await view.rerender(<ErrorState actionLabel="重试" message="加载失败，请重试。" onAction={retry} />);
  await fireEvent.press(view.getByRole('button', { name: '重试' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
