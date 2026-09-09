import { fireEvent, render } from '@testing-library/react-native';
import { RecordDateTimeField, mergeDateTimePart } from './record-date-time-field';

jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@react-native-community/datetimepicker', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return function MockDateTimePicker(props: object) { return React.createElement(View, { ...props, testID: 'date-time-picker' }); };
});

test('editing one local date-time part preserves the other part', () => {
  const current = new Date(2026, 8, 9, 9, 42, 12, 500).getTime();
  expect(new Date(mergeDateTimePart(current, new Date(2026, 8, 8), 'date')))
    .toEqual(new Date(2026, 8, 8, 9, 42, 12, 500));
  expect(new Date(mergeDateTimePart(current, new Date(2026, 0, 1, 8, 15), 'time')))
    .toEqual(new Date(2026, 8, 9, 8, 15, 0, 0));
});

test('dismissing date selection leaves value unchanged and time picker uses 24 hours', async () => {
  const onChange = jest.fn();
  const maximumDate = new Date(2026, 8, 9);
  const view = await render(<RecordDateTimeField label="记录时间" valueMs={maximumDate.getTime()} maximumDate={maximumDate}
    onChange={onChange} dateAccessibilityLabel="修改日期" timeAccessibilityLabel="修改时间" />);
  await fireEvent.press(view.getByLabelText('修改日期'));
  const datePicker = view.getByTestId('date-time-picker');
  expect(datePicker.props.maximumDate).toBe(maximumDate);
  await fireEvent(datePicker, 'onDismiss');
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('修改时间'));
  const timePicker = view.getByTestId('date-time-picker');
  expect(timePicker.props.is24Hour).toBe(true);
  expect(timePicker.props.maximumDate).toBeUndefined();
});
