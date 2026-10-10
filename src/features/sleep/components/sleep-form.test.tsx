import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SleepValidationError } from '@/domain/sleep/sleep-validation';
import { createSleepActionLock, SleepForm } from './sleep-form';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return function MockDateTimePicker(props: { maximumDate: Date }) {
    return React.createElement(View, { ...props, testID: 'sleep-date-picker' });
  };
});

afterEach(() => jest.restoreAllMocks());

describe('sleep form submission lock', () => {
  test('ignores a second action while the first save is pending', async () => {
    const lock = createSleepActionLock();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const action = jest.fn(() => pending);

    const first = lock(action);
    await lock(action);
    expect(action).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  test('opens an editable finish confirmation before completing an active sleep', async () => {
    const startMs = new Date(2026, 6, 11, 1, 0).getTime();
    const nowMs = new Date(2026, 6, 11, 2, 0).getTime();
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const onFinish = jest.fn(async () => undefined);
    const screen = await render(
      <SleepForm
        mode="active"
        initialValue={{ startMs, endMs: null, note: null }}
        nowMs={nowMs}
        onSave={async () => undefined}
        onFinish={onFinish}
      />,
    );
    expect(screen.queryByLabelText('确认结束睡眠')).toBeNull();
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByLabelText('修改结束时间')).toBeTruthy();
    expect(screen.queryByLabelText('保存睡眠修改')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByLabelText('确认结束睡眠')); });
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(nowMs, { startMs, note: null }));
  });

  test('captures the click time across midnight and preserves it while confirmation waits', async () => {
    const startMs = new Date(2026, 6, 10, 23, 0).getTime();
    const cachedNowMs = new Date(2026, 6, 10, 23, 59, 50).getTime();
    const clickMs = new Date(2026, 6, 11, 0, 0, 10).getTime();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(clickMs);
    const onFinish = jest.fn(async () => undefined);
    const screen = await render(<SleepForm mode="active"
      initialValue={{ startMs, endMs: null, note: null }} nowMs={cachedNowMs}
      onSave={jest.fn()} onFinish={onFinish} />);
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('修改结束日期'));
    expect(screen.getByTestId('sleep-date-picker').props.maximumDate).toEqual(new Date(clickMs));
    clock.mockReturnValue(clickMs + 5 * 60_000);
    await screen.rerender(<SleepForm mode="active"
      initialValue={{ startMs, endMs: null, note: null }} nowMs={clickMs + 5 * 60_000}
      onSave={jest.fn()} onFinish={onFinish} />);
    await fireEvent.press(screen.getByLabelText('确认结束睡眠'));
    expect(onFinish).toHaveBeenCalledWith(clickMs, { startMs, note: null });
  });

  test('preserves a manually selected finish time and takes a fresh click after cancelling', async () => {
    const startMs = new Date(2026, 6, 11, 1, 0).getTime();
    const cachedNowMs = startMs + 60 * 60_000;
    const clickMs = cachedNowMs + 20_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(clickMs);
    const onFinish = jest.fn(async () => undefined);
    const screen = await render(<SleepForm mode="active"
      initialValue={{ startMs, endMs: null, note: null }} nowMs={cachedNowMs}
      onSave={jest.fn()} onFinish={onFinish} />);
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('取消结束睡眠'));
    clock.mockReturnValue(clickMs + 60_000);
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('醒来时间：10分钟前'));
    const selectedMs = clickMs + 60_000 - 10 * 60_000;
    clock.mockReturnValue(clickMs + 5 * 60_000);
    await fireEvent.press(screen.getByLabelText('确认结束睡眠'));
    expect(onFinish).toHaveBeenCalledWith(selectedMs, { startMs, note: null });
  });

  test('takes a fresh timestamp when finish confirmation is cancelled and reopened', async () => {
    const startMs = new Date(2026, 6, 11, 1, 0).getTime();
    const cachedNowMs = startMs + 60 * 60_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(cachedNowMs + 20_000);
    const onFinish = jest.fn(async () => undefined);
    const screen = await render(<SleepForm mode="active"
      initialValue={{ startMs, endMs: null, note: null }} nowMs={cachedNowMs}
      onSave={jest.fn()} onFinish={onFinish} />);
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('取消结束睡眠'));
    const reopenedMs = cachedNowMs + 80_000;
    clock.mockReturnValue(reopenedMs);
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('确认结束睡眠'));
    expect(onFinish).toHaveBeenCalledWith(reopenedMs, { startMs, note: null });
  });

  test('cancel finish keeps the active sleep and unsaved note unchanged', async () => {
    const startMs = new Date(2026, 8, 9, 9, 0).getTime();
    const nowMs = new Date(2026, 8, 9, 9, 42).getTime();
    const onFinish = jest.fn(async () => undefined);
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <SleepForm mode="active" initialValue={{ startMs, endMs: null, note: null }} nowMs={nowMs} onSave={onSave} onFinish={onFinish} />,
    );
    await fireEvent.changeText(screen.getByLabelText('睡眠备注'), '刚刚睡着');
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    expect(onFinish).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('取消结束睡眠'));
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('修改结束时间')).toBeNull();
    expect(screen.getByLabelText('宝宝醒了')).toBeTruthy();
    expect(screen.getByLabelText('睡眠备注').props.value).toBe('刚刚睡着');
    await fireEvent.press(screen.getByLabelText('保存睡眠修改'));
    expect(onSave).toHaveBeenCalledWith({ startMs, endMs: null, note: '刚刚睡着' });
  });

  test('keeps end validation feedback in the editable confirmation without finishing or saving', async () => {
    const startMs = new Date(2026, 8, 9, 9, 0).getTime();
    const onFinish = jest.fn(async () => { throw new SleepValidationError('结束时间必须晚于开始时间'); });
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <SleepForm mode="active" initialValue={{ startMs, endMs: null, note: null }} nowMs={startMs} onSave={onSave} onFinish={onFinish} />,
    );
    await fireEvent.press(screen.getByLabelText('宝宝醒了'));
    await fireEvent.press(screen.getByLabelText('确认结束睡眠'));
    await waitFor(() => expect(screen.getByText('结束时间必须晚于开始时间')).toBeTruthy());
    expect(screen.getByLabelText('修改结束时间')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('取消结束睡眠'));
    expect(screen.queryByText('结束时间必须晚于开始时间')).toBeNull();
    expect(screen.getByLabelText('宝宝醒了')).toBeTruthy();
  });

  test('completed sleep displays its duration without the active illustration state', async () => {
    const startMs = new Date(2026, 8, 9, 9, 0).getTime();
    const screen = await render(
      <SleepForm mode="completed" initialValue={{ startMs, endMs: startMs + 42 * 60_000, note: null }} nowMs={startMs + 60 * 60_000} onSave={jest.fn()} />,
    );
    expect(screen.getByText('本次睡眠 42分钟')).toBeTruthy();
    expect(screen.queryByText('宝宝正在睡觉')).toBeNull();
    expect(screen.queryByLabelText('宝宝醒了')).toBeNull();
    expect(screen.getByLabelText('保存睡眠修改')).toBeTruthy();
  });
});
