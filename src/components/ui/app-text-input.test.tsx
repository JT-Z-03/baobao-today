import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AppTextInput } from '@/components/ui/app-text-input';
import { Colors } from '@/constants/theme';

test('text input has consistent focus and error presentation', async () => {
  const view = await render(
    <AppTextInput accessibilityLabel="备注" error="备注内容无效" onChangeText={jest.fn()} placeholder="选填" value="" />,
  );
  const input = view.getByLabelText('备注');
  expect(input.props.placeholderTextColor).toBe(Colors.light.textMuted);
  expect(input.props.accessibilityHint).toBe('备注内容无效');
  expect(StyleSheet.flatten(input.props.style).borderColor).toBe(Colors.light.danger);

  await view.rerender(<AppTextInput accessibilityLabel="备注" onChangeText={jest.fn()} placeholder="选填" value="" />);
  const normalInput = view.getByLabelText('备注');
  await fireEvent(normalInput, 'focus');
  expect(StyleSheet.flatten(view.getByLabelText('备注').props.style).borderColor).toBe(Colors.light.inputFocused);
});
