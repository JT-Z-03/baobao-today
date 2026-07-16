import { TimelineRow } from '@/components/ui/timeline-row';
import type { PoopRecord } from '@/domain/poop/poop';
import { formatEventTime } from '@/features/feeding/feeding-format';
import { formatPoopDetails } from '@/features/poop/poop-format';

type Props = { record: PoopRecord; onPress(): void };

export function PoopRecordRow({ record, onPress }: Props) {
  const details = formatPoopDetails(record);
  return (
    <TimelineRow
      accessibilityLabel={`编辑大便记录 ${formatEventTime(record.eventTimeMs)}`}
      detail={details}
      hasNote={Boolean(record.note)}
      hasPhoto={Boolean(record.photoUri)}
      note={record.note ? `备注：${record.note}` : null}
      onPress={onPress}
      time={formatEventTime(record.eventTimeMs)}
      title="大便"
      type="poop"
    />
  );
}
