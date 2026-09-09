import { TimelineRow, type TimelineConnector } from '@/components/ui/timeline-row';
import type { FeedingRecord } from '@/domain/feeding/feeding';
import { formatEventTime, formatFeedingDetails } from '@/features/feeding/feeding-format';

type Props = { connector?: TimelineConnector;
  record: FeedingRecord;
  onPress(): void;
};

export function FeedingRecordRow({ record, onPress, connector }: Props) {
  const summary = `${formatEventTime(record.eventTimeMs)} · ${formatFeedingDetails(record)}`;

  return (
    <TimelineRow
      connector={connector}
      accessibilityLabel={`编辑喝奶记录 ${summary}`}
      detail={formatFeedingDetails(record)}
      hasNote={Boolean(record.note)}
      note={record.note ? `备注：${record.note}` : null}
      onPress={onPress}
      time={formatEventTime(record.eventTimeMs)}
      title="喝奶"
      type="feeding"
    />
  );
}
