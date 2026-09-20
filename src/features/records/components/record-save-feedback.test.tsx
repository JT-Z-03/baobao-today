import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { RecordSaveFeedback, showRecordSaved } from './record-save-feedback';

const mockPush = jest.fn();
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function saved() {
  const screen = await render(<RecordSaveFeedback />);
  await act(async () => {
    showRecordSaved('feeding', { id: 'actual-saved-id', eventTimeMs: Date.now(), breastMilkAmountMl: 80 });
  });
  return screen;
}

test('shows the actual saved amount and opens its returned record ID', async () => {
  const screen = await saved();
  expect(screen.getByText(/瓶喂母乳 80 ml/)).toBeTruthy();
  await fireEvent.press(screen.getByText('查看 / 修改'));
  expect(mockPush).toHaveBeenCalledWith('/feeding/actual-saved-id');
  expect(screen.queryByText(/已记录/)).toBeNull();
});

test('expires ordinary feedback, but waits while its action has keyboard focus', async () => {
  const screen = await saved();
  await fireEvent(screen.getByText('查看 / 修改'), 'focus');
  await act(async () => { jest.advanceTimersByTime(8_000); });
  expect(screen.getByText(/已记录/)).toBeTruthy();
  await fireEvent(screen.getByText('查看 / 修改'), 'blur');
  await act(async () => { jest.advanceTimersByTime(7_000); });
  expect(screen.queryByText(/已记录/)).toBeNull();
});

test('keeps feedback available to a screen reader until dismissed', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const screen = await saved();
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.getByText(/已记录/)).toBeTruthy();
  await fireEvent.press(screen.getByText('知道了'));
  expect(screen.queryByText(/已记录/)).toBeNull();
});
