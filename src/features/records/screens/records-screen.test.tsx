import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { RecordsScreen } from './records-screen';

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

test('history filters expose a non-color selected state and a useful empty state', async () => {
  const empty = jest.fn(async () => []);
  jest.mocked(useAppState).mockReturnValue({
    feedingService: { getHistory: empty },
    poopService: { getHistory: empty },
    peeService: { getHistory: empty },
    sleepService: { getSourceHistory: empty },
    otherService: { getHistory: empty },
  } as never);

  const view = await render(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('这一天还没有记录')).toBeTruthy());
  expect(view.getByLabelText('选择记录日期').props.accessibilityHint).toBe('打开日期选择器');

  await fireEvent.press(view.getByLabelText('筛选喝奶'));
  expect(view.getByLabelText('筛选喝奶，已选择').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('这一天还没有喝奶记录').parent?.props.accessibilityRole).toBe('summary');
});
