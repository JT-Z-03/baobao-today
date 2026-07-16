import { render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { TodayScreen } from './today-screen';

const mockPush = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

function appState() {
  const nowMs = new Date(2026, 6, 12, 12, 0).getTime();
  return {
    babyProfile: {
      id: 'baby',
      name: '这是一个用于验证系统字体放大时不会重叠的宝宝昵称',
      birthDate: '2026-07-01',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
    feedingService: { getDashboard: jest.fn(async () => ({
      latest: null,
      timeline: [],
      summary: { feedingCount: 0, formulaTotalMl: 0 },
      refreshedAtMs: nowMs,
    })) },
    poopService: { getHistory: jest.fn(async () => []), getDailyCount: jest.fn(async () => 0) },
    peeService: { getHistory: jest.fn(async () => []), getDailyCount: jest.fn(async () => 0) },
    sleepService: { getDashboard: jest.fn(async () => ({ active: null, timeline: [], completedTotalMs: 0, refreshedAtMs: nowMs })) },
    otherService: { getHistory: jest.fn(async () => []) },
  };
}

test('today empty state and quick actions remain understandable with large text', async () => {
  jest.mocked(useAppState).mockReturnValue(appState() as never);
  const view = await render(<TodayScreen />);

  await waitFor(() => expect(view.getByText('今天还没有记录').parent?.props.accessibilityRole).toBe('summary'));
  expect(view.getByText(/这是一个用于验证/).props.numberOfLines).toBe(2);
  expect(view.getByLabelText('记录喝奶').props.accessibilityHint).toBe('新建喝奶记录');
  expect(view.getByLabelText('记录大便').props.accessibilityHint).toBe('新建大便记录');
  expect(view.getByLabelText('记录小便').props.accessibilityHint).toBe('新建小便记录');
  expect(view.getByLabelText('开始睡眠').props.accessibilityHint).toBe('开始一条睡眠记录');
  expect(view.getByLabelText('记录其他事件').props.accessibilityHint).toBe('新建其他记录');
});
