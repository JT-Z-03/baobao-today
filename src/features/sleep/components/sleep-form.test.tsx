import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SleepValidationError } from '@/domain/sleep/sleep-validation';
import { createSleepActionLock, SleepForm } from './sleep-form';

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
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(nowMs));
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
