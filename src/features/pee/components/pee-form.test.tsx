import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { createPeeSubmissionLock, PeeForm } from './pee-form';

const initialInput = {
  eventTimeMs: new Date(2026, 6, 11, 8, 0).getTime(),
  amount: null,
  color: null,
  note: null,
};

describe('PeeForm', () => {
  test.each(['stable-request', null])('shows optional fields immediately and saves time-only input (request: %s)', async (clientRequestId) => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PeeForm initialInput={initialInput} clientRequestId={clientRequestId} onSave={onSave} />,
    );
    expect(screen.getByLabelText('选择尿量 少')).toBeVisible();
    expect(screen.getByLabelText('选择尿液颜色 淡黄')).toBeVisible();
    expect(screen.getByLabelText('备注')).toBeVisible();
    expect(screen.queryByText('更多信息')).toBeNull();
    expect(screen.queryByLabelText(/展开更多信息|收起更多信息/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('保存小便记录'));
    expect(onSave).toHaveBeenCalledWith(initialInput, clientRequestId);
  });

  test('allows selecting and clearing optional values directly', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PeeForm initialInput={initialInput} clientRequestId="stable-request" onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('选择尿量 中'));
    await fireEvent.press(screen.getByLabelText('选择尿液颜色 淡黄'));
    expect(screen.getByLabelText('选择尿量 中').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('选择尿液颜色 淡黄').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByLabelText('选择尿量 中'));
    await fireEvent.press(screen.getByLabelText('选择尿液颜色 淡黄'));
    await fireEvent.press(screen.getByLabelText('保存小便记录'));
    expect(onSave).toHaveBeenCalledWith(initialInput, 'stable-request');
  });

  test('submission lock rejects a second save while the first is pending', async () => {
    let finish: (() => void) | undefined;
    const lock = createPeeSubmissionLock();
    const firstTask = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const duplicateTask = jest.fn(async () => undefined);
    const firstRun = lock.run(firstTask);
    await expect(lock.run(duplicateTask)).resolves.toBe(false);
    expect(duplicateTask).not.toHaveBeenCalled();
    finish?.();
    await expect(firstRun).resolves.toBe(true);
  });

  test('saves optional values without an extra expansion step', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PeeForm initialInput={initialInput} clientRequestId="stable-request" onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('选择尿量 中'));
    await fireEvent.press(screen.getByLabelText('选择尿液颜色 淡黄'));
    await fireEvent.changeText(screen.getByLabelText('备注'), '换尿布时记录');
    await fireEvent.press(screen.getByLabelText('保存小便记录'));
    expect(onSave).toHaveBeenCalledWith({
      ...initialInput, amount: 'medium', color: 'light_yellow', note: '换尿布时记录',
    }, 'stable-request');
  });

  test('shows existing optional values on edit and disables save while pending', async () => {
    let finish: (() => void) | undefined;
    const onSave = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await render(
      <PeeForm
        initialInput={{ ...initialInput, amount: 'large', color: 'dark_yellow', note: '夜间记录' }}
        clientRequestId={null}
        submitLabel="保存修改"
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText('选择尿量 多').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('选择尿液颜色 深黄').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('备注').props.value).toBe('夜间记录');
    fireEvent.press(screen.getByLabelText('保存小便记录'));
    await waitFor(() => {
      expect(screen.getByLabelText('保存小便记录').props.accessibilityState.disabled).toBe(true);
    });
    await act(async () => { finish?.(); });
  });
});
