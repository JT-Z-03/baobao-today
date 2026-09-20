import type { RecordDraftService } from './record-draft-service';
import type { RecordDraft } from '@/domain/drafts/record-draft';

type RecordValue = { id: string; updatedAtMs: number } & Record<string, unknown>;
export type SubmissionLookup = {
  getById(id: string): Promise<unknown>;
  getByClientRequestId(id: string): Promise<unknown>;
};

function comparable(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item)]));
  return value;
}

export function matchesSubmission(record: Record<string, unknown>, submission: Record<string, unknown>) {
  return Object.entries(submission).every(([key, value]) => {
    if (key === 'photoChange') return (value as { kind: string }).kind === 'keep';
    if (key === 'photo') return value === null && record.photoUri === null;
    return JSON.stringify(comparable(record[key])) === JSON.stringify(comparable(value));
  });
}

export function createRecordSubmissionService(drafts: RecordDraftService) {
  return {
    async reconcile(draft: RecordDraft, lookup: SubmissionLookup) {
      const value = draft.recordId ? await lookup.getById(draft.recordId) : await lookup.getByClientRequestId(draft.clientRequestId);
      const record = value as RecordValue | null;
      if (draft.status !== 'submitting') {
        if (draft.recordId && (!record || (draft.baseRecord && draft.baseRecord.updatedAtMs !== record.updatedAtMs))) return { kind: 'conflict' as const, record };
        return { kind: 'editing' as const, record };
      }
      if (record && (!draft.recordId || (draft.submission && matchesSubmission(record, draft.submission)))) {
        await drafts.committed(draft.id, record.id);
        return { kind: 'committed' as const, record };
      }
      if (!draft.recordId && !record) {
        await drafts.retryEditing(draft.id);
        return { kind: 'editing' as const, record: null };
      }
      if (record && draft.baseRecord?.updatedAtMs === record.updatedAtMs) {
        await drafts.retryEditing(draft.id);
        return { kind: 'editing' as const, record };
      }
      return { kind: 'conflict' as const, record };
    },
    async submit(draft: RecordDraft, payload: Record<string, unknown>, lookup: SubmissionLookup,
      mutation: (requestId: string) => Promise<unknown>) {
      await drafts.assertGeneration(draft.generation);
      if (draft.recordId) {
        const current = await lookup.getById(draft.recordId) as RecordValue | null;
        if (!current || (draft.baseRecord && current.updatedAtMs !== draft.baseRecord.updatedAtMs)) {
          throw new Error('原记录已变化，请返回核对后再修改；本次内容仍保留在草稿中');
        }
      }
      await drafts.freeze(draft.id, payload);
      try {
        await mutation(draft.clientRequestId);
      } catch (error) {
        const current = draft.recordId ? await lookup.getById(draft.recordId) : await lookup.getByClientRequestId(draft.clientRequestId);
        if (current && (!draft.recordId || matchesSubmission(current as RecordValue, payload))) {
          await drafts.committed(draft.id, (current as RecordValue).id);
          return current as RecordValue;
        }
        // The request ID and frozen payload remain recoverable if this lookup itself fails.
        await drafts.retryEditing(draft.id);
        throw error;
      }
      const record = (draft.recordId ? await lookup.getById(draft.recordId) : await lookup.getByClientRequestId(draft.clientRequestId)) as RecordValue | null;
      if (!record) throw new Error('保存结果尚未确认，请返回后核对，勿重复新建记录');
      await drafts.committed(draft.id, record.id);
      return record;
    },
  };
}
