import { TimelineRow, type TimelineConnector } from '@/components/ui/timeline-row';
import { shiftLocalDateKey, toLocalDateKey } from '@/domain/date/local-date';
import type { SleepRecord } from '@/domain/sleep/sleep';
import { formatSleepClock, formatSleepRecordDuration } from '@/features/sleep/sleep-format';

type Props = { connector?: TimelineConnector; record: SleepRecord; nowMs: number; onPress(): void };

export function SleepHistoryRow({ record, nowMs, onPress, connector }: Props) {
  const endDate = record.endMs === null ? null : toLocalDateKey(record.endMs);
  const endDatePrefix = endDate === null || endDate === record.recordDate
    ? ''
    : endDate === shiftLocalDateKey(record.recordDate, 1)
      ? '次日'
      : `${new Date(record.endMs!).getMonth() + 1}月${new Date(record.endMs!).getDate()}日 `;
  const endLabel = record.endMs === null
    ? '睡眠中'
    : `${endDatePrefix}${formatSleepClock(record.endMs)}`;
  const range = `${formatSleepClock(record.startMs)} - ${endLabel}`;

  return (
    <TimelineRow
      connector={connector}
      accessibilityLabel={`编辑睡眠记录 ${range}`}
      detail={record.status === 'sleeping'
        ? `已睡 ${formatSleepRecordDuration(record, nowMs)}`
        : `${range} · 睡眠 ${formatSleepRecordDuration(record, nowMs)}`}
      hasNote={Boolean(record.note)}
      note={record.note ? `备注：${record.note}` : null}
      onPress={onPress}
      time={formatSleepClock(record.startMs)}
      title={record.status === 'sleeping' ? '正在睡觉' : '睡眠'}
      type="sleep"
    />
  );
}
