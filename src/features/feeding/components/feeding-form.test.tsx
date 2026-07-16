import { fireEvent, render } from '@testing-library/react-native';

import { createSubmissionLock, FeedingForm } from './feeding-form';

const eventTimeMs = new Date(2026, 6, 11, 8, 0).getTime();
const initialInput = {
  eventTimeMs,
  feedingType: 'formula' as const,
  milkAmountMl: 60,
  leftDurationMin: null,
  rightDurationMin: null,
  note: null,
};

describe('FeedingForm', () => {
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

    expect(screen.getByLabelText('奶量')).toBeTruthy();
    expect(screen.queryByLabelText('左侧时长')).toBeNull();

    await fireEvent.press(screen.getByLabelText('选择母乳'));
    expect(screen.queryByLabelText('奶量')).toBeNull();
    expect(screen.getByLabelText('左侧时长')).toBeTruthy();
    expect(screen.getByLabelText('右侧时长')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('选择混合'));
    expect(screen.getByLabelText('奶量')).toBeTruthy();
    expect(screen.getByLabelText('左侧时长')).toBeTruthy();
  });
});
