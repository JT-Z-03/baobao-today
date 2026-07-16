import { TimelineRow } from '@/components/ui/timeline-row';
import type { SleepTimelineOccurrence } from '@/domain/sleep/sleep';
import { formatSleepClock, formatSleepDuration } from '@/features/sleep/sleep-format';

type Props = { occurrence: SleepTimelineOccurrence; onPress(): void };

export function SleepRecordRow({ occurrence, onPress }: Props) {
  const isEnd = occurrence.kind === 'sleep-end';
  const duration = occurrence.record.endMs === null
    ? null
    : formatSleepDuration(occurrence.record.endMs - occurrence.record.startMs);
  const details = isEnd && duration ? `睡眠结束 · 睡眠 ${duration}` : '开始睡眠';

  return (
    <TimelineRow
      accessibilityLabel={`编辑睡眠记录 ${formatSleepClock(occurrence.occurrenceTimeMs)} ${details}`}
      detail={isEnd && duration ? `睡眠 ${duration}` : null}
      hasNote={Boolean(occurrence.record.note)}
      note={occurrence.record.note ? `备注：${occurrence.record.note}` : null}
      onPress={onPress}
      time={formatSleepClock(occurrence.occurrenceTimeMs)}
      title={isEnd ? '睡眠结束' : '开始睡眠'}
      type="sleep"
    />
  );
}
