import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import { shiftLocalDateKey, toLocalDateKey } from '@/domain/date/local-date';
import type { OtherRecord } from '@/domain/other/other';

import { RecordsScreen } from './records-screen';

let mockParams: { date?: string | string[] } = {};
let mockFocusKey = 0;
const mockRouter = {
  push: jest.fn(),
  setParams: jest.fn((params: { date?: string }) => { mockParams = { ...mockParams, ...params }; }),
};

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback, mockFocusKey]),
  };
});

function configureServices(other: OtherRecord[] = []) {
  const empty = jest.fn(async () => []);
  const otherHistory = jest.fn(async () => other);
  const state = {
    babyProfile: { name: '小满', birthDate: '2026-08-25' },
    feedingService: { getHistory: empty },
    poopService: { getHistory: empty },
    peeService: { getHistory: empty },
    sleepService: { getSourceHistory: empty },
    otherService: { getHistory: otherHistory },
  };
  jest.mocked(useAppState).mockReturnValue(state as never);
  return { state, empty, otherHistory };
}

beforeEach(() => {
  mockParams = {};
  mockFocusKey = 0;
  mockRouter.push.mockClear();
  mockRouter.setParams.mockClear();
});

test('history filters expose a non-color selected state and a useful empty state', async () => {
  configureServices();
  const view = await render(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('这一天还没有记录')).toBeTruthy());
  expect(view.getByText('小满的每一天')).toBeTruthy();
  expect(view.getByLabelText('选择记录日期').props.accessibilityHint).toBe('打开日期选择器');
  expect(view.getByLabelText('后一天').props.accessibilityState.disabled).toBe(true);

  await fireEvent.press(view.getByLabelText('筛选喝奶'));
  expect(view.getByLabelText('筛选喝奶，已选择').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('这一天还没有喝奶记录').parent?.props.accessibilityRole).toBe('summary');
});

test('consumes explicit date navigation each time and preserves ordinary tab selections', async () => {
  const today = toLocalDateKey(Date.now());
  const yesterday = shiftLocalDateKey(today, -1);
  const { otherHistory } = configureServices();
  mockParams = { date: today };
  const view = await render(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('这一天还没有记录')).toBeTruthy());
  expect(mockRouter.setParams).toHaveBeenCalledWith({ date: undefined });
  expect(mockRouter.setParams).toHaveBeenCalledTimes(1);

  await fireEvent.press(view.getByLabelText('前一天'));
  await fireEvent.press(view.getByLabelText('筛选其他'));
  await waitFor(() => expect(otherHistory).toHaveBeenLastCalledWith(yesterday));
  mockFocusKey += 1;
  await view.rerender(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('这一天还没有其他记录')).toBeTruthy());
  expect(otherHistory).toHaveBeenLastCalledWith(yesterday);
  expect(view.getByLabelText('筛选其他，已选择')).toBeTruthy();
  expect(mockRouter.setParams).toHaveBeenCalledTimes(1);

  mockParams = { date: today };
  await view.rerender(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('这一天还没有记录')).toBeTruthy());
  expect(otherHistory).toHaveBeenLastCalledWith(today);
  expect(view.getByLabelText('筛选全部，已选择')).toBeTruthy();
  expect(mockRouter.setParams).toHaveBeenCalledTimes(2);
});

test('keeps all source records available beyond the three-row home preview', async () => {
  const now = Date.now();
  const records: OtherRecord[] = Array.from({ length: 4 }, (_, index) => ({
    type: 'other', id: `other-${index}`, title: `事项 ${index}`, note: '保留备注',
    clientRequestId: `request-${index}`, createPayloadHash: `hash-${index}`,
    eventTimeMs: now - index * 60_000, sortTimeMs: now - index * 60_000,
    createdAtMs: now, updatedAtMs: now, recordDate: toLocalDateKey(now),
  }));
  configureServices(records);
  const view = await render(<RecordsScreen />);
  await waitFor(() => expect(view.getByLabelText('编辑其他记录 事项 3')).toBeTruthy());
  expect(view.getAllByLabelText(/编辑其他记录 事项/)).toHaveLength(4);
  await fireEvent.press(view.getByLabelText('编辑其他记录 事项 3'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/other/[id]', params: { id: 'other-3' } });
  await fireEvent.press(view.getByLabelText('筛选喝奶'));
  expect(view.getByText('这一天还没有喝奶记录')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('筛选全部'));
  expect(view.getAllByLabelText(/编辑其他记录 事项/)).toHaveLength(4);
});

test('does not display an empty day before loading has finished', async () => {
  const { state } = configureServices();
  let resolveHistory!: (records: OtherRecord[]) => void;
  state.otherService.getHistory.mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve; }));
  const view = await render(<RecordsScreen />);
  expect(view.getByText('正在读取这一天的记录')).toBeTruthy();
  expect(view.queryByText('这一天还没有记录')).toBeNull();
  await act(async () => resolveHistory([]));
  expect(view.getByText('这一天还没有记录')).toBeTruthy();
});

test('retries a failed history load without exposing raw storage errors', async () => {
  const { otherHistory } = configureServices();
  otherHistory.mockRejectedValueOnce(new Error('SQLite failed at /data/user/0/app.db'));
  const view = await render(<RecordsScreen />);
  await waitFor(() => expect(view.getByText('历史记录加载失败，请重试。')).toBeTruthy());
  expect(view.queryByText(/SQLite|\/data\//)).toBeNull();
  await fireEvent.press(view.getByLabelText('重新加载历史记录'));
  await waitFor(() => expect(view.getByText('这一天还没有记录')).toBeTruthy());
  expect(otherHistory).toHaveBeenCalledTimes(2);
});
