import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppTextInput } from '@/components/ui/app-text-input';

afterEach(() => jest.restoreAllMocks());

test.each(['android', 'ios'] as const)('%s applies the read-only text selection compatibility guard', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const view = await render(<ThemedText selectable>小满</ThemedText>);
  expect(view.getByText('小满').props.selectable).toBe(platform === 'ios');
});

test('Android text fields retain selection and editing', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onChangeText = jest.fn();
  const view = await render(
    <AppTextInput accessibilityLabel="备注" onChangeText={onChangeText} selectTextOnFocus value="原备注" />,
  );
  const input = view.getByLabelText('备注');
  expect(input.props.selectTextOnFocus).toBe(true);
  await fireEvent.changeText(input, '新备注');
  expect(onChangeText).toHaveBeenCalledWith('新备注');
});
