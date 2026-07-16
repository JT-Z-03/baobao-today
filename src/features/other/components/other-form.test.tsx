import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { createOtherSubmissionLock, OtherForm } from './other-form';

const initialInput = {
  eventTimeMs: new Date(2026, 6, 11, 10, 30).getTime(),
  title: '',
  note: null,
};

describe('OtherForm', () => {
  test('fills a shortcut but still allows a custom title', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <OtherForm initialInput={initialInput} clientRequestId="stable" onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('快捷标题 洗澡'));
    expect(screen.getByLabelText('标题').props.value).toBe('洗澡');
    await fireEvent.changeText(screen.getByLabelText('标题'), '自定义事件');
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    expect(onSave).toHaveBeenCalledWith({ ...initialInput, title: '自定义事件' }, 'stable');
  });

  test('shows a clear Chinese validation message for an empty title', async () => {
    const onSave = jest.fn(async () => { throw new Error('请填写标题'); });
    const screen = await render(
      <OtherForm initialInput={initialInput} clientRequestId="stable" onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    await waitFor(() => expect(screen.getByText('请填写标题')).toBeTruthy());
  });

  test('submission lock ignores a second save while the first is pending', async () => {
    const lock = createOtherSubmissionLock();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const task = jest.fn(() => pending);
    const first = lock.run(task);
    await expect(lock.run(task)).resolves.toBe(false);
    expect(task).toHaveBeenCalledTimes(1);
    finish();
    await expect(first).resolves.toBe(true);
  });

  test('backs edit values, clears notes, and disables save while pending', async () => {
    let finish!: () => void;
    const onSave = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await render(
      <OtherForm
        initialInput={{ ...initialInput, title: '打嗝', note: '原备注' }}
        clientRequestId={null}
        submitLabel="保存修改"
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText('标题').props.value).toBe('打嗝');
    expect(screen.getByLabelText('备注').props.value).toBe('原备注');
    await fireEvent.changeText(screen.getByLabelText('备注'), '');
    fireEvent.press(screen.getByLabelText('保存其他记录'));
    await waitFor(() => expect(screen.getByLabelText('保存其他记录').props.accessibilityState.disabled).toBe(true));
    expect(onSave).toHaveBeenCalledWith({ ...initialInput, title: '打嗝', note: null }, null);
    await act(async () => finish());
  });
});
