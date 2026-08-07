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

function appState(feedingSummary = {
  feedingCount: 0,
  formulaTotalMl: 0,
  breastMilkTotalMl: 0,
  measurableTotalMl: 0,
}) {
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
      summary: feedingSummary,
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

test('today overview preserves feeding summary card order and field mapping', async () => {
  jest.mocked(useAppState).mockReturnValue(appState({
    feedingCount: 6,
    formulaTotalMl: 120,
    breastMilkTotalMl: 180,
    measurableTotalMl: 777,
  }) as never);
  const view = await render(<TodayScreen />);

  await waitFor(() => expect(view.getByText('6次')).toBeTruthy());
  const feedingMetricCards = view.getByText('喝奶次数').parent?.parent?.children.slice(0, 4);

  expect(feedingMetricCards).toEqual([
    view.getByText('喝奶次数').parent,
    view.getByText('可计量合计').parent,
    view.getByText('瓶喂母乳').parent,
    view.getByText('奶粉').parent,
  ]);
  expect(view.getByText('6次').parent).toBe(view.getByText('喝奶次数').parent);
  expect(view.getByText('777ml').parent).toBe(view.getByText('可计量合计').parent);
  expect(view.getByText('180ml').parent).toBe(view.getByText('瓶喂母乳').parent);
  expect(view.getByText('120ml').parent).toBe(view.getByText('奶粉').parent);
});
