import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { FeedingFormScreen } from './feeding-form-screen';

const mockNow = new Date(2026, 8, 9, 9, 42).getTime();
const mockRouter = { back: jest.fn() };
const mockDefaults = {
  eventTimeMs: mockNow, feedingType: 'bottle_breast', milkAmountMl: null, breastMilkAmountMl: 90,
};
const mockRecord = {
  ...mockDefaults, id: 'feeding-1', leftDurationMin: null, rightDurationMin: null, note: '原备注',
};
const mockFeedingService = {
  createClientRequestId: jest.fn(() => 'request-1'),
  getNewRecordDefaults: jest.fn(async () => mockDefaults),
  getById: jest.fn(async () => mockRecord),
  create: jest.fn(async () => ({ reminderStatus: { kind: 'disabled' } })),
  update: jest.fn(async () => ({ reminderStatus: { kind: 'disabled' } })),
  delete: jest.fn(async () => ({ reminderStatus: { kind: 'disabled' } })),
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/application/app-state/app-state-provider', () => ({
  useAppState: () => ({ feedingService: mockFeedingService, babyProfile: { name: '小满', birthDate: '2026-08-25' } }),
}));

describe('FeedingFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);
    mockFeedingService.create.mockResolvedValue({ reminderStatus: { kind: 'disabled' } });
  });
  afterEach(() => jest.restoreAllMocks());

  test('uses service defaults and the real profile while saving one stable request', async () => {
    const screen = await render(<FeedingFormScreen />);
    await screen.findByLabelText('瓶喂母乳量');
    expect(screen.getByText('小满 · 出生第 16 天')).toBeTruthy();
    expect(screen.getByLabelText('瓶喂母乳量').props.value).toBe('90');
    expect(screen.getByText('保存记录')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));
    await waitFor(() => expect(mockFeedingService.create).toHaveBeenCalledWith({
      ...mockDefaults, leftDurationMin: null, rightDurationMin: null, note: null,
    }, 'request-1'));
    expect(mockFeedingService.create).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('reports a saved record with failed reminder sync and returns without creating it again', async () => {
    mockFeedingService.create.mockResolvedValue({ reminderStatus: { kind: 'sync-error' } });
    const screen = await render(<FeedingFormScreen />);
    await screen.findByLabelText('保存喝奶记录');
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));
    await screen.findByText('记录已保存，但提醒更新失败。请稍后在设置中重试。');
    expect(mockRouter.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '返回' }));
    expect(mockFeedingService.create).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('editing preserves bottled amount and deletes only after explicit confirmation', async () => {
    const screen = await render(<FeedingFormScreen recordId="feeding-1" />);
    await screen.findByLabelText('删除喝奶记录');
    expect(screen.getByText('保存修改')).toBeTruthy();
    expect(screen.getByLabelText('瓶喂母乳量').props.value).toBe('90');
    expect(screen.getByLabelText('备注').props.value).toBe('原备注');
    await fireEvent.press(screen.getByLabelText('删除喝奶记录'));
    await fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(mockFeedingService.delete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('删除喝奶记录'));
    await fireEvent.press(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockFeedingService.delete).toHaveBeenCalledWith('feeding-1'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockFeedingService.create).not.toHaveBeenCalled();
  });
});
