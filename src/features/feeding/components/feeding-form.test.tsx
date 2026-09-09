import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { FeedingValidationError } from '@/domain/feeding/feeding-validation';
import { createSubmissionLock, FeedingForm } from './feeding-form';

const eventTimeMs = new Date(2026, 6, 11, 8, 0).getTime();
const initialInput = {
  eventTimeMs,
  feedingType: 'formula' as const,
  milkAmountMl: 60,
  breastMilkAmountMl: null,
  leftDurationMin: null,
  rightDurationMin: null,
  note: null,
};

describe('FeedingForm', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each(['android', 'ios'] as const)('%s keeps typed bottle digits and uses platform-safe auto-selection', async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const onSave = jest.fn(async () => undefined);
    const screen = await render(<FeedingForm initialInput={initialInput} clientRequestId="typed-bottle" onSave={onSave} />);
    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));
    for (const value of ['', '1', '12', '120']) {
      await fireEvent.changeText(screen.getByLabelText('瓶喂母乳量'), value);
      expect(screen.getByLabelText('瓶喂母乳量').props.selectTextOnFocus).toBe(platform !== 'android');
    }
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      feedingType: 'bottle_breast', breastMilkAmountMl: 120, milkAmountMl: null,
    }), 'typed-bottle');
  });

  test('uses the stable form request id when saving', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={onSave}
      />,
    );

    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(initialInput, 'stable-request');
  });

  test('shows a note validation error and clears it when the note changes', async () => {
    const onSave = jest.fn(async () => {
      throw new FeedingValidationError('note', '备注不能超过200个字符');
    });
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={onSave}
      />,
    );

    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));

    await waitFor(() => expect(screen.getByText('备注不能超过200个字符')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('备注'), '补充说明');
    expect(screen.queryByText('备注不能超过200个字符')).toBeNull();
  });

  test('submission lock rejects a concurrent duplicate task', async () => {
    let finishFirst: (() => void) | undefined;
    const lock = createSubmissionLock();
    const firstTask = jest.fn(() => new Promise<void>((resolve) => (finishFirst = resolve)));
    const duplicateTask = jest.fn(async () => undefined);

    const firstRun = lock.run(firstTask);
    await expect(lock.run(duplicateTask)).resolves.toBe(false);
    expect(duplicateTask).not.toHaveBeenCalled();
    finishFirst?.();
    await expect(firstRun).resolves.toBe(true);
  });

  test('shows only fields applicable to the selected feeding type', async () => {
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={jest.fn(async () => undefined)}
      />,
    );

    expect(screen.getByLabelText('奶粉量')).toBeTruthy();
    expect(screen.queryByLabelText('左侧时长')).toBeNull();

    await fireEvent.press(screen.getByLabelText('选择亲喂母乳'));
    expect(screen.queryByLabelText('奶粉量')).toBeNull();
    expect(screen.getByLabelText('左侧时长')).toBeTruthy();
    expect(screen.getByLabelText('右侧时长')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('选择混合'));
    expect(screen.getByLabelText('奶粉量')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('混合包含亲喂母乳'));
    expect(screen.getByLabelText('左侧时长')).toBeTruthy();
  });

  test('shows bottled breast milk as a fourth top-level feeding type', async () => {
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={jest.fn(async () => undefined)}
      />,
    );

    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));

    expect(screen.getByLabelText('瓶喂母乳量')).toBeTruthy();
    expect(screen.queryByLabelText('奶粉量')).toBeNull();
    expect(screen.queryByLabelText('左侧时长')).toBeNull();
    expect(screen.getByText('奶量')).toBeTruthy();
    expect(screen.queryByText('瓶喂母乳量')).toBeNull();
  });

  test('single bottle breast milk writes only its own amount using the stable request', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <FeedingForm initialInput={initialInput} clientRequestId="stable-request" onSave={onSave} />,
    );
    expect(screen.getByText('奶量')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));
    await fireEvent.changeText(screen.getByLabelText('瓶喂母乳量'), '90');
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      feedingType: 'bottle_breast', milkAmountMl: null, breastMilkAmountMl: 90,
      leftDurationMin: null, rightDurationMin: null,
    }), 'stable-request');
  });

  test('amount controls keep feeding-specific accessibility names after the visible label changes', async () => {
    const screen = await render(
      <FeedingForm initialInput={initialInput} clientRequestId="stable-request" onSave={jest.fn()} />,
    );
    await fireEvent.press(screen.getByLabelText('奶粉量增加10'));
    expect(screen.getByLabelText('奶粉量').props.value).toBe('70');
    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));
    await fireEvent.press(screen.getByLabelText('瓶喂母乳量增加10'));
    expect(screen.getByLabelText('瓶喂母乳量').props.value).toBe('10');
    await fireEvent.press(screen.getByLabelText('选择奶粉'));
    expect(screen.getByLabelText('奶粉量').props.value).toBe('70');
  });

  test('submits only selected mixed components and keeps temporary values while switching', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={onSave}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText('奶粉量'), '70');
    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));
    await fireEvent.changeText(screen.getByLabelText('瓶喂母乳量'), '80');
    await fireEvent.press(screen.getByLabelText('选择亲喂母乳'));
    await fireEvent.changeText(screen.getByLabelText('左侧时长'), '10');
    await fireEvent.press(screen.getByLabelText('选择混合'));
    await fireEvent.press(screen.getByLabelText('混合包含瓶喂母乳'));
    await fireEvent.press(screen.getByLabelText('混合包含亲喂母乳'));
    expect(screen.getByLabelText('奶粉量').props.value).toBe('70');
    expect(screen.getByLabelText('瓶喂母乳量').props.value).toBe('80');
    expect(screen.getByLabelText('左侧时长').props.value).toBe('10');
    await fireEvent.press(screen.getByLabelText('混合包含奶粉'));
    await fireEvent.press(screen.getByLabelText('混合包含瓶喂母乳'));
    expect(screen.queryByLabelText('瓶喂母乳量')).toBeNull();
    await fireEvent.press(screen.getByLabelText('混合包含瓶喂母乳'));
    expect(screen.getByLabelText('瓶喂母乳量').props.value).toBe('80');
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      feedingType: 'mixed',
      milkAmountMl: null,
      breastMilkAmountMl: 80,
      leftDurationMin: 10,
      rightDurationMin: 0,
    }), 'stable-request');
  });

  test('shows required errors for selected formula and bottled breast milk amounts', async () => {
    const screen = await render(
      <FeedingForm
        initialInput={{ ...initialInput, milkAmountMl: null }}
        clientRequestId="stable-request"
        onSave={jest.fn(async () => undefined)}
      />,
    );

    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));
    expect(screen.getByText('请填写奶粉量')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('选择瓶喂母乳'));
    await fireEvent.press(screen.getByLabelText('保存喝奶记录'));
    expect(screen.getByText('请填写瓶喂母乳量')).toBeTruthy();
  });

  test('shows an error when mixed feeding has fewer than two components', async () => {
    const screen = await render(
      <FeedingForm
        initialInput={initialInput}
        clientRequestId="stable-request"
        onSave={jest.fn(async () => undefined)}
      />,
    );

    await fireEvent.press(screen.getByLabelText('选择混合'));

    expect(screen.getByText('混合喂养至少选择两项')).toBeTruthy();
  });
});
