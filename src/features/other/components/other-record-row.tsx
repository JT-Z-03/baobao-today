import { TimelineRow } from '@/components/ui/timeline-row';
import type { OtherRecord } from '@/domain/other/other';
import { formatOtherClock, summarizeOtherNote } from '@/features/other/other-format';

type Props = { record: OtherRecord; onPress(): void };

export function OtherRecordRow({ record, onPress }: Props) {
  const noteSummary = summarizeOtherNote(record.note);
  return (
    <TimelineRow
      accessibilityLabel={`编辑其他记录 ${record.title}`}
      hasNote={Boolean(noteSummary)}
      note={noteSummary}
      onPress={onPress}
      time={formatOtherClock(record.eventTimeMs)}
      title={record.title}
      type="other"
    />
  );
}
