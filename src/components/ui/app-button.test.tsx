import { fireEvent, render } from '@testing-library/react-native';

import { AppButton } from '@/components/ui/app-button';

test('primary button exposes a stable accessible loading state', async () => {
  const onPress = jest.fn();
  const view = await render(<AppButton label="保存" onPress={onPress} />);

  await fireEvent.press(view.getByRole('button', { name: '保存' }));
  expect(onPress).toHaveBeenCalledTimes(1);

  await view.rerender(<AppButton label="保存" loading onPress={onPress} />);
  const loadingButton = view.getByRole('button', { name: '保存' });
  expect(loadingButton.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
  expect(view.getByText('保存')).toBeTruthy();
  expect(view.getByTestId('app-button-spinner')).toBeTruthy();
});

test('destructive and disabled states are explicit', async () => {
  const view = await render(<AppButton disabled label="删除记录" onPress={jest.fn()} variant="destructive" />);
  expect(view.getByRole('button', { name: '删除记录' }).props.accessibilityState.disabled).toBe(true);
});

test('disclosure buttons preserve expanded accessibility state', async () => {
  const view = await render(<AppButton accessibilityState={{ expanded: true }} label="收起说明" onPress={jest.fn()} variant="ghost" />);
  expect(view.getByRole('button', { name: '收起说明' }).props.accessibilityState).toEqual(expect.objectContaining({
    expanded: true,
    busy: false,
    disabled: false,
  }));
});
