import type { RecordDraftService } from '@/application/drafts/record-draft-service';
import type { RecordKind } from '@/domain/drafts/record-draft';

export async function discardDeletedDraft(service: RecordDraftService | null | undefined, babyId: string | undefined, kind: RecordKind, recordId: string) {
  if (!service || !babyId) return;
  try {
    const { draft } = await service.get({ babyId, kind, recordId });
    if (!draft) return;
    await service.discard(draft.id);
    await service.cleanupDiscardedAttachment(draft);
  } catch {
    // The record is already deleted. The home entry retains recovery/discard
    // controls if this independent metadata cleanup needs another attempt.
  }
}
