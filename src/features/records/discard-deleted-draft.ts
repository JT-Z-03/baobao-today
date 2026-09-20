import type { RecordDraftService } from '@/application/drafts/record-draft-service';
import type { RecordKind } from '@/domain/drafts/record-draft';
import { ExpoDraftAttachmentStore } from '@/data/workflow/expo-draft-attachment-store';

export async function discardDeletedDraft(service: RecordDraftService | null | undefined, babyId: string | undefined, kind: RecordKind, recordId: string) {
  if (!service || !babyId) return;
  try {
    const { draft } = await service.get({ babyId, kind, recordId });
    if (!draft) return;
    await service.discard(draft.id);
    if (draft.kind === 'poop' && draft.values.photoChange.kind === 'replace') {
      await new ExpoDraftAttachmentStore().remove(draft.values.photoChange.source.uri);
    }
  } catch {
    // The record is already deleted. The home entry retains recovery/discard
    // controls if this independent metadata cleanup needs another attempt.
  }
}
