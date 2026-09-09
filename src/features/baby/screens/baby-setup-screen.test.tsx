import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { BabySetupScreen } from './baby-setup-screen';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, push: mockPush }) }));

describe('BabySetupScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
  });

  test('explains local-only storage without presenting account setup', async () => {
    (useAppState as jest.Mock).mockReturnValue({ saveInitialBabyProfile: jest.fn() });
    const screen = await render(<BabySetupScreen />);

    expect(screen.getByText('资料和记录只保存在当前手机')).toBeTruthy();
    expect(screen.queryByText(/登录|注册|云同步/)).toBeNull();
    expect(screen.getByLabelText('宝宝昵称')).toBeTruthy();
    expect(screen.getByLabelText('选择出生日期')).toBeTruthy();
  });

  test('keeps infrastructure details out of a failed save', async () => {
    const saveInitialBabyProfile = jest.fn(async () => {
      throw new Error('SQLite constraint failed at /data/user/0/database.db');
    });
    (useAppState as jest.Mock).mockReturnValue({ saveInitialBabyProfile });
    const screen = await render(<BabySetupScreen />);

    await fireEvent.changeText(screen.getByLabelText('宝宝昵称'), '小宝');
    await fireEvent.press(screen.getByLabelText('开始记录'));

    await waitFor(() => expect(screen.getByText('宝宝资料保存失败，请重试。')).toBeTruthy());
    expect(screen.queryByText(/SQLite|\/data\//)).toBeNull();
  });
});
