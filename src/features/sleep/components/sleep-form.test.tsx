import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
    expect(screen.getByLabelText('修改结束时间')).toBeTruthy();
    expect(screen.queryByLabelText('保存睡眠修改')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByLabelText('确认结束睡眠')); });
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(nowMs));
  });
});
