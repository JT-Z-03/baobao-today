import type { FeedingComponent, FeedingType } from '@/domain/feeding/feeding';
import type { BreastfeedingTimer } from '@/domain/feeding/breastfeeding-timer';
import type { PeeAmount, PeeColor } from '@/domain/pee/pee';
import type { PoopPhotoChange, PoopAmount, PoopColor, PoopTexture } from '@/domain/poop/poop';

export type RecordKind = 'feeding' | 'pee' | 'poop' | 'sleep' | 'other';
export type DraftValues = {
  feeding: { eventTimeMs: number; feedingType: FeedingType | null; milkAmount: string;
    breastMilkAmount: string; leftDuration: string; rightDuration: string; note: string;
    mixedComponents: FeedingComponent[] };
  pee: { eventTimeMs: number; amount: PeeAmount | null; color: PeeColor | null; note: string };
  poop: { eventTimeMs: number; amount: PoopAmount | null; color: PoopColor | null;
    texture: PoopTexture | null; note: string; photoChange: PoopPhotoChange; previewUri: string | null };
  sleep: { startMs: number; endMs: number | null; note: string };
  other: { eventTimeMs: number; title: string; note: string };
};
export type RecordDraft = {
  [K in RecordKind]: {
    id: string; key: string; kind: K; babyId: string; generation: string;
    recordId: string | null; clientRequestId: string; revision: number; updatedAtMs: number;
    status: 'editing' | 'submitting' | 'committed' | 'discarded'; values: DraftValues[K];
    baseRecord: Record<string, unknown> | null; submission: Record<string, unknown> | null;
    resultRecordId: string | null; timer: BreastfeedingTimer | null;
  }
}[RecordKind];

export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  feeding: '喝奶', pee: '小便', poop: '大便', sleep: '睡眠', other: '其他',
};

export function draftKey(babyId: string, kind: RecordKind, recordId?: string | null) {
  return `${babyId}:${kind}:${recordId ?? 'new'}`;
}

export function isPendingDraft(draft: RecordDraft) {
  return draft.status === 'editing' || draft.status === 'submitting';
}
