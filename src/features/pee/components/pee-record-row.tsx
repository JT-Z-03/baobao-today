import { TimelineRow } from '@/components/ui/timeline-row';
import type { PeeRecord } from '@/domain/pee/pee';
import { formatEventTime } from '@/features/feeding/feeding-format';
import { formatPeeDetails } from '@/features/pee/pee-format';

type Props = { record: PeeRecord; onPress(): void };

export function PeeRecordRow({ record, onPress }: Props) {
  const details = formatPeeDetails(record);
  return (
    <TimelineRow
      accessibilityLabel={`编辑小便记录 ${formatEventTime(record.eventTimeMs)}`}
      detail={details}
      hasNote={Boolean(record.note)}
      note={record.note ? `备注：${record.note}` : null}
      onPress={onPress}
      time={formatEventTime(record.eventTimeMs)}
      title="小便"
      type="pee"
    />
  );
}
