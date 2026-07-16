import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { OtherFormScreen } from './other-form-screen';

const mockRouterBack = jest.fn();
const mockOtherService = {
  createClientRequestId: jest.fn(() => 'request-1'),
  getCurrentTimeMs: jest.fn(() => 100),
  create: jest.fn(async () => undefined),
  getById: jest.fn(async () => ({
    id: 'other-1', type: 'other', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
    eventTimeMs: 100, recordDate: '1970-01-01', sortTimeMs: 100,
    createdAtMs: 100, updatedAtMs: 100, title: '很长但不会进入确认文案的标题', note: '原备注',
  })),
  update: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
  getHistory: jest.fn(async () => []),
};

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockRouterBack }) }));
jest.mock('@/application/app-state/app-state-provider', () => ({
  useAppState: () => ({ otherService: mockOtherService }),
}));

describe('OtherFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates with one stable request ID and returns after success', async () => {
    const screen = await render(<OtherFormScreen />);
    const title = await screen.findByLabelText('标题');
    await fireEvent.changeText(title, '洗澡');
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    await waitFor(() => expect(mockOtherService.create).toHaveBeenCalledWith({
      eventTimeMs: 100, title: '洗澡', note: null,
    }, 'request-1'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  test('loads edit values and uses the themed safe delete confirmation', async () => {
    const screen = await render(<OtherFormScreen recordId="other-1" />);
    const deleteButton = await screen.findByLabelText('删除其他记录');
    expect(screen.getByLabelText('标题').props.value).toBe('很长但不会进入确认文案的标题');
    expect(screen.getByLabelText('备注').props.value).toBe('原备注');

    await fireEvent.press(deleteButton);
    expect(screen.getByText('确定删除这条记录吗？')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockOtherService.delete).toHaveBeenCalledWith('other-1'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
  });
});
