import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { PeeFormScreen } from './pee-form-screen';

const mockRouterBack = jest.fn();
const mockPeeService = {
  createClientRequestId: jest.fn(() => 'request-1'),
  getCurrentTimeMs: jest.fn(() => 100),
  create: jest.fn(async () => undefined),
  getById: jest.fn(async () => ({
    id: 'pee-1', type: 'pee', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
    eventTimeMs: 100, recordDate: '1970-01-01', sortTimeMs: 100,
    createdAtMs: 100, updatedAtMs: 100, amount: 'medium', color: 'light_yellow', note: null,
  })),
  update: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
  getHistory: jest.fn(async () => []),
  getDailyCount: jest.fn(async () => 0),
};

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockRouterBack }) }));
jest.mock('@/application/app-state/app-state-provider', () => ({
  useAppState: () => ({ peeService: mockPeeService, babyProfile: { name: '示例宝宝', birthDate: '1970-01-01' } }),
}));

describe('PeeFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads edit values and requires the exact delete confirmation', async () => {
    const screen = await render(<PeeFormScreen recordId="pee-1" />);
    const deleteButton = await screen.findByLabelText('删除小便记录');
    expect(screen.getByText('示例宝宝 · 出生第 1 天')).toBeTruthy();
    expect(screen.getByLabelText('选择尿量 中').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(deleteButton);
    expect(screen.getByText('确定删除这条小便记录吗？')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockPeeService.delete).toHaveBeenCalledWith('pee-1'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
  });
});
