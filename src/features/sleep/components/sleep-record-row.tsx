import { TimelineRow, type TimelineConnector } from '@/components/ui/timeline-row';
import type { SleepTimelineOccurrence } from '@/domain/sleep/sleep';
import { formatSleepClock, formatSleepDuration } from '@/features/sleep/sleep-format';

type Props = { connector?: TimelineConnector; occurrence: SleepTimelineOccurrence; onPress(): void };

export function SleepRecordRow({ occurrence, onPress, connector }: Props) {
  const isEnd = occurrence.kind === 'sleep-end';
  const duration = occurrence.record.endMs === null
    ? null
    : formatSleepDuration(occurrence.record.endMs - occurrence.record.startMs);
  const details = isEnd && duration ? `睡眠结束 · 睡眠 ${duration}` : '开始睡眠';
  const isActiveStart = !isEnd && occurrence.record.status === 'sleeping';

  return (
    <TimelineRow
      connector={connector}
      accessibilityLabel={`编辑睡眠记录 ${formatSleepClock(occurrence.occurrenceTimeMs)} ${details}${isActiveStart ? ' · 正在睡觉' : ''}`}
      detail={isEnd && duration ? `睡眠 ${duration}` : isActiveStart ? '正在睡觉' : null}
      hasNote={Boolean(occurrence.record.note)}
      note={occurrence.record.note ? `备注：${occurrence.record.note}` : null}
      onPress={onPress}
      time={formatSleepClock(occurrence.occurrenceTimeMs)}
      title={isEnd ? '睡眠结束' : '开始睡眠'}
      type="sleep"
    />
  );
}
