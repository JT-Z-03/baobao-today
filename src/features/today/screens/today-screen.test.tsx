import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { TodayScreen } from './today-screen';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
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
  expect(view.getByText(/这是一个用于验证/).props.numberOfLines).toBeUndefined();
  expect(view.getByLabelText('记录喝奶').props.accessibilityHint).toBe('新建喝奶记录');
  expect(view.getByLabelText('记录大便').props.accessibilityHint).toBe('新建大便记录');
  expect(view.getByLabelText('记录小便').props.accessibilityHint).toBe('新建小便记录');
  expect(view.getByLabelText('开始睡眠').props.accessibilityHint).toBe('开始一条睡眠记录');
  expect(view.getByLabelText('记录其他事件').props.accessibilityHint).toBe('新建其他记录');
});

test('today milk total consumes the measurable service summary and preserves details', async () => {
  jest.mocked(useAppState).mockReturnValue(appState({
    feedingCount: 6,
    formulaTotalMl: 120,
    breastMilkTotalMl: 180,
    measurableTotalMl: 777,
  }) as never);
  const view = await render(<TodayScreen />);

  await waitFor(() => expect(view.getByLabelText('今日奶量777毫升')).toBeTruthy());
  expect(view.getByLabelText('今日喝奶6次')).toBeTruthy();
  expect(view.queryByLabelText('今日奶粉120毫升')).toBeNull();
  await fireEvent.press(view.getByLabelText('展开今日明细'));
  expect(view.getByLabelText('今日奶粉120毫升')).toBeTruthy();
  expect(view.getByLabelText('今日瓶喂母乳180毫升')).toBeTruthy();
});

test('loading does not show zero statistics and a failed load can retry', async () => {
  const state = appState();
  state.feedingService.getDashboard.mockRejectedValueOnce(new Error('database failure'));
  jest.mocked(useAppState).mockReturnValue(state as never);
  const view = await render(<TodayScreen />);
  expect(view.queryByLabelText('今日奶量0毫升')).toBeNull();
  await waitFor(() => expect(view.getByText('今日记录加载失败，请重试。')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('重新加载'));
  await waitFor(() => expect(view.getByLabelText('今日奶量0毫升')).toBeTruthy());
  expect(state.feedingService.getDashboard).toHaveBeenCalledTimes(2);
});

test('home preview shows three most recent events and opens all records by local date', async () => {
  const state = appState();
  state.otherService.getHistory.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({
    id: `other-${i}`, type: 'other', title: `事项${i}`, note: null,
    eventTimeMs: new Date(2026, 8, 9, 10, i).getTime(), createdAtMs: i,
    recordDate: '2026-09-09', updatedAtMs: i,
  })) as never);
  jest.mocked(useAppState).mockReturnValue(state as never);
  const view = await render(<TodayScreen />);
  await waitFor(() => expect(view.getByText('事项4')).toBeTruthy());
  expect(view.getByText('事项2')).toBeTruthy();
  expect(view.queryByText('事项1')).toBeNull();
  await fireEvent.press(view.getByLabelText('查看今天全部记录'));
  expect(mockNavigate).toHaveBeenLastCalledWith({ pathname: '/records', params: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
});

test('sleep summary uses compact visible units and complete spoken units', async () => {
  const state = appState();
  state.sleepService.getDashboard.mockResolvedValue({
    active: null, timeline: [], completedTotalMs: (5 * 60 + 20) * 60_000, refreshedAtMs: Date.now(),
  });
  jest.mocked(useAppState).mockReturnValue(state as never);
  const view = await render(<TodayScreen />);
  await waitFor(() => expect(view.getByLabelText('今日已完成睡眠5小时20分钟')).toBeTruthy());
  expect(view.getByText('5小时20分')).toBeTruthy();
  expect(view.queryByText('5小时20分钟')).toBeNull();
});

test('active sleep keeps duration and start time readable while wake only opens its record', async () => {
  const state = appState();
  const nowMs = new Date(2026, 8, 9, 9, 47).getTime();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
  const startMs = new Date(2026, 8, 9, 9, 0).getTime();
  const finish = jest.fn();
  state.sleepService.getDashboard.mockResolvedValue({
    active: { id: 'sleep-active', status: 'sleeping', startMs, endMs: null },
    timeline: [], completedTotalMs: 0, refreshedAtMs: nowMs,
  } as never);
  jest.mocked(useAppState).mockReturnValue({ ...state, sleepService: { ...state.sleepService, finish } } as never);
  try {
    const view = await render(<TodayScreen />);
    await waitFor(() => expect(view.getByLabelText('睡着啦，已睡47分钟')).toBeTruthy());
    expect(view.getByText('睡着啦 · 已睡 47分')).toBeTruthy();
    expect(view.getByText('09:00 开始')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('宝宝醒了'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/sleep/[id]', params: { id: 'sleep-active' } });
    expect(finish).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
