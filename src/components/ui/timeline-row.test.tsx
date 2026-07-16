import { fireEvent, render } from '@testing-library/react-native';

import { TimelineRow } from '@/components/ui/timeline-row';

jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));

test('timeline row presents time, type, details and lightweight indicators', async () => {
  const onPress = jest.fn();
  const view = await render(
    <TimelineRow
      accessibilityLabel="编辑大便记录 06:18"
      detail="黄色 · 稀软 · 中"
      hasNote
      hasPhoto
      onPress={onPress}
      time="06:18"
      title="大便"
      type="poop"
    />,
  );

  expect(view.getByText('06:18')).toBeTruthy();
  expect(view.getByText('大便')).toBeTruthy();
  expect(view.getByText('黄色 · 稀软 · 中')).toBeTruthy();
  expect(view.getByLabelText('有备注')).toBeTruthy();
  expect(view.getByLabelText('有照片')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: '编辑大便记录 06:18' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});
