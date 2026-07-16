import { fireEvent, render } from '@testing-library/react-native';

import { ChoiceChip } from '@/components/ui/choice-chip';

test('choice chip announces selection and can be pressed again to clear it', async () => {
  const onPress = jest.fn();
  const view = await render(<ChoiceChip label="黄色" onPress={onPress} selected />);

  const chip = view.getByRole('button', { name: '黄色，已选择' });
  expect(chip.props.accessibilityState.selected).toBe(true);
  expect(view.getByTestId('choice-chip-check')).toBeTruthy();
  await fireEvent.press(chip);
  expect(onPress).toHaveBeenCalledTimes(1);
});
