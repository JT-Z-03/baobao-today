import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { SleepFormScreen } from './sleep-form-screen';

const mockNow = new Date(2026, 8, 9, 9, 42).getTime();
const mockStart = new Date(2026, 8, 9, 9, 0).getTime();
const mockRouter = { back: jest.fn(), replace: jest.fn() };
const mockRecord = { id: 'sleep-1', status: 'sleeping', startMs: mockStart, endMs: null, note: '原备注' };
const mockSleepService = {
  createClientRequestId: jest.fn(() => 'sleep-request'),
  getCurrentTimeMs: jest.fn(() => mockNow),
  getActive: jest.fn(async (): Promise<typeof mockRecord | null> => null),
  getById: jest.fn(async () => mockRecord),
  start: jest.fn(async () => ({ outcome: 'created' })),
  updateActive: jest.fn(async () => undefined),
  updateCompleted: jest.fn(async () => undefined),
  finishAt: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/application/app-state/app-state-provider', () => ({
  useAppState: () => ({ sleepService: mockSleepService, babyProfile: { name: '小满', birthDate: '2026-08-25' } }),
}));

describe('SleepFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);
    mockSleepService.getActive.mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  test('new sleep uses the service clock and stable request without creating a completed record', async () => {
    const screen = await render(<SleepFormScreen />);
    await screen.findByLabelText('开始睡眠');
    expect(screen.getByText('小满 · 出生第 16 天')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('开始睡眠'));
    await waitFor(() => expect(mockSleepService.start).toHaveBeenCalledWith({ startMs: mockNow, note: null }, 'sleep-request'));
    expect(mockSleepService.finishAt).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('an existing active sleep redirects new-entry navigation to its record', async () => {
    mockSleepService.getActive.mockResolvedValue(mockRecord);
    await render(<SleepFormScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/sleep/[id]', params: { id: 'sleep-1' } }));
    expect(mockSleepService.start).not.toHaveBeenCalled();
  });

  test('active sleep finishes only after confirmation and keeps save as a separate action', async () => {
    const screen = await render(<SleepFormScreen recordId="sleep-1" />);
    await screen.findByLabelText('宝宝醒了');
    expect(screen.getByText('已睡 42分钟')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    expect(mockSleepService.finishAt).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('取消结束睡眠'));
    expect(mockSleepService.finishAt).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('确认结束睡眠'));
    await waitFor(() => expect(mockSleepService.finishAt).toHaveBeenCalledWith('sleep-1', mockNow, { startMs: mockStart, note: '原备注' }));
    expect(mockSleepService.finishAt).toHaveBeenCalledTimes(1);
    expect(mockSleepService.updateActive).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('active sleep updates its note without ending the timer and deletion can be cancelled', async () => {
    const screen = await render(<SleepFormScreen recordId="sleep-1" />);
    await screen.findByLabelText('睡眠备注');
    await fireEvent.press(screen.getByLabelText('删除睡眠记录'));
    expect(screen.getByText('确定删除正在进行的睡眠记录吗？删除后本次睡眠计时将停止。')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(mockSleepService.delete).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('睡眠备注'), '轻拍后睡着');
    await fireEvent.press(screen.getByLabelText('保存睡眠修改'));
    await waitFor(() => expect(mockSleepService.updateActive).toHaveBeenCalledWith('sleep-1', { startMs: mockStart, note: '轻拍后睡着' }));
    expect(mockSleepService.finishAt).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
