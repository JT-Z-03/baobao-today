import { fireEvent, render } from '@testing-library/react-native';

import type { SleepTimelineOccurrence } from '@/domain/sleep/sleep';

import { SleepRecordRow } from './sleep-record-row';

jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));

function occurrence(completed = false, isEnd = false): SleepTimelineOccurrence {
  const startMs = new Date(2026, 8, 9, 9, 0).getTime();
  const endMs = startMs + 2 * 60 * 60_000;
  const shared = {
    id: 'sleep-1', type: 'sleep' as const, clientRequestId: 'request-1', createPayloadHash: 'hash-1',
    eventTimeMs: startMs, recordDate: '2026-09-09', sortTimeMs: startMs,
    createdAtMs: startMs, updatedAtMs: startMs, startMs, note: null,
  };
  return {
    type: 'sleep-occurrence', recordId: 'sleep-1', kind: isEnd ? 'sleep-end' : 'sleep-start',
    occurrenceTimeMs: isEnd ? endMs : startMs, sortTimeMs: isEnd ? endMs : startMs, createdAtMs: startMs,
    record: completed ? { ...shared, status: 'completed', endMs } : { ...shared, status: 'sleeping', endMs: null },
  };
}

test('an active start explains the current sleeping state and opens the source record', async () => {
  const onPress = jest.fn();
  const view = await render(<SleepRecordRow occurrence={occurrence()} onPress={onPress} />);
  expect(view.getByText('开始睡眠')).toBeTruthy();
  expect(view.getByText('正在睡觉')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('编辑睡眠记录 09:00 开始睡眠 · 正在睡觉'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('a completed start preserves the start-event meaning without claiming it is active', async () => {
  const view = await render(<SleepRecordRow occurrence={occurrence(true)} onPress={jest.fn()} />);
  expect(view.getByText('开始睡眠')).toBeTruthy();
  expect(view.queryByText('正在睡觉')).toBeNull();
  expect(view.getByLabelText('编辑睡眠记录 09:00 开始睡眠')).toBeTruthy();
});

test('an end event still displays its complete duration', async () => {
  const view = await render(<SleepRecordRow occurrence={occurrence(true, true)} onPress={jest.fn()} />);
  expect(view.getByText('睡眠结束')).toBeTruthy();
  expect(view.getByText('睡眠 2小时')).toBeTruthy();
  expect(view.queryByText('正在睡觉')).toBeNull();
});
