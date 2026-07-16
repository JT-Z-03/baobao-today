import { fireEvent, render } from '@testing-library/react-native';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

test('danger confirmation keeps cancel as the safe default and supports long copy', async () => {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  const view = await render(
    <ConfirmDialog
      confirmLabel="确认恢复"
      message="恢复会替换当前宝宝资料、全部记录、照片和相关本地设置，不会与现有数据合并。"
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="确认替换当前数据"
      variant="destructive"
      visible
    />,
  );

  expect(view.getByText(/不会与现有数据合并/)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: '取消' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: '确认恢复' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
