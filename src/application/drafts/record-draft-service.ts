import type { WorkflowState, WorkflowStateStore } from '@/application/ports/workflow-state';
import { draftKey, isPendingDraft, type DraftValues, type RecordDraft, type RecordKind } from '@/domain/drafts/record-draft';
import { createTimer, transitionTimer, timerMinutes, timerTotals, type BreastSide, type TimerAction } from '@/domain/feeding/breastfeeding-timer';

export type DraftScope = { babyId: string; kind: RecordKind; recordId?: string | null };
export class DraftStateError extends Error {}

export function createRecordDraftService(store: WorkflowStateStore, now: () => number, createId: () => string) {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  async function change<T>(update: (state: WorkflowState) => T) {
    const result = await store.transaction(update); emit(); return result;
  }
  function editable(state: WorkflowState, id: string, allowSubmitting = false) {
    const draft = Object.values(state.drafts).find((item) => item.id === id);
    if (state.restore || !draft || draft.generation !== state.generation
      || !(draft.status === 'editing' || (allowSubmitting && draft.status === 'submitting'))) {
      throw new DraftStateError('草稿状态已变化，请返回后重新核对');
    }
    return draft;
  }
  return {
    store,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async get(scope: DraftScope) {
      const state = await store.read();
      const draft = state.drafts[draftKey(scope.babyId, scope.kind, scope.recordId)];
      return { draft: draft && isPendingDraft(draft) ? draft : null, quarantined: !!state.restore || (!!draft && draft.generation !== state.generation),
        generation: state.generation };
    },
    async list() {
      const state = await store.read();
      return { drafts: Object.values(state.drafts).filter(isPendingDraft).sort((a, b) => b.updatedAtMs - a.updatedAtMs),
        quarantined: !!state.restore, generation: state.generation };
    },
    async create<K extends RecordKind>(scope: DraftScope & { kind: K }, values: DraftValues[K],
      baseRecord: Record<string, unknown> | null = null) {
      return change((state) => {
        if (state.restore) throw new DraftStateError('上次恢复被中断，旧草稿需核对');
        const key = draftKey(scope.babyId, scope.kind, scope.recordId);
        const current = state.drafts[key];
        if (current && isPendingDraft(current)) throw new DraftStateError('已有未完成记录，请先继续或放弃它');
        const draft = { id: createId(), key, kind: scope.kind, babyId: scope.babyId,
          generation: state.generation, recordId: scope.recordId ?? null, clientRequestId: createId(),
          revision: 1, updatedAtMs: now(), status: 'editing', values, baseRecord, submission: null,
          resultRecordId: null, timer: null } as RecordDraft;
        state.drafts[key] = draft;
        return draft;
      });
    },
    async update(id: string, values: RecordDraft['values'], expectedRevision?: number) {
      return change((state) => {
        const draft = editable(state, id);
        if (expectedRevision !== undefined && draft.revision !== expectedRevision) {
          throw new DraftStateError('草稿已更新，请重新打开后继续');
        }
        draft.values = values; draft.revision++; draft.updatedAtMs = now();
        return draft;
      });
    },
    async freeze(id: string, submission: Record<string, unknown>) {
      return change((state) => {
        const draft = editable(state, id, true);
        if (draft.status === 'submitting' && JSON.stringify(draft.submission) !== JSON.stringify(submission)) {
          throw new DraftStateError('上次提交尚未核对，请先确认是否已经保存');
        }
        draft.submission = submission; draft.status = 'submitting'; draft.revision++; return draft;
      });
    },
    async retryEditing(id: string) {
      return change((state) => {
        const draft = editable(state, id, true);
        draft.status = 'editing'; draft.submission = null; draft.revision++; return draft;
      });
    },
    async committed(id: string, recordId: string) {
      return change((state) => {
        const draft = editable(state, id, true);
        draft.status = 'committed'; draft.resultRecordId = recordId;
        draft.timer = null; draft.revision++;
      });
    },
    async discard(id: string) {
      return change((state) => {
        const draft = Object.values(state.drafts).find((item) => item.id === id);
        if (draft) delete state.drafts[draft.key];
        // Clearing the last quarantined item also resolves an interrupted restore boundary.
        if (state.restore && !Object.values(state.drafts).some(isPendingDraft)) {
          state.generation = createId(); state.restore = null;
        }
        return draft ?? null;
      });
    },
    async recoverAsNew(id: string, babyId?: string) {
      return change((state) => {
        const draft = Object.values(state.drafts).find((item) => item.id === id);
        if (!draft || (!state.restore && draft.generation === state.generation && !draft.recordId)) throw new DraftStateError('没有需要核对的旧草稿');
        const targetKey = draftKey(babyId ?? draft.babyId, draft.kind);
        const existing = state.drafts[targetKey];
        if (existing && existing.id !== id && isPendingDraft(existing)) {
          throw new DraftStateError('当前已有同类草稿，请先完成它，再恢复旧内容');
        }
        delete state.drafts[draft.key];
        if (state.restore) state.generation = createId();
        state.restore = null;
        draft.id = createId(); draft.clientRequestId = createId(); draft.recordId = null;
        draft.babyId = babyId ?? draft.babyId;
        draft.generation = state.generation; draft.key = targetKey;
        draft.status = 'editing'; draft.baseRecord = null; draft.submission = null; draft.resultRecordId = null;
        if (draft.kind === 'feeding' && draft.timer && !draft.timer.finished) {
          draft.timer = transitionTimer(draft.timer, { type: 'finish' }, now());
          if (!draft.timer.issue && draft.timer.leftMs + draft.timer.rightMs > 0) {
            const rounded = timerMinutes(timerTotals(draft.timer, now()));
            draft.values.leftDuration = String(rounded.left); draft.values.rightDuration = String(rounded.right);
          }
        }
        draft.revision++; draft.updatedAtMs = now(); state.drafts[draft.key] = draft;
        return draft;
      });
    },
    async timerAction(id: string, action: TimerAction | { type: 'start'; side: BreastSide }) {
      return change((state) => {
        const draft = editable(state, id);
        if (draft.kind !== 'feeding' || draft.recordId) throw new DraftStateError('仅新建喝奶支持计时');
        if (action.type === 'start') {
          if (Object.values(state.drafts).some((other) => other.id !== id && other.timer && !other.timer.finished)) {
            throw new DraftStateError('已有亲喂计时，请先继续那条记录');
          }
          if (draft.timer && !draft.timer.finished) return draft;
          draft.timer = createTimer(action.side, now());
          draft.values.eventTimeMs = draft.timer.startedAtMs;
        } else {
          if (!draft.timer) throw new DraftStateError('请先开始计时');
          draft.timer = transitionTimer(draft.timer, action, now());
          if (action.type === 'finish' && !draft.timer.issue) {
            const totals = timerTotals(draft.timer, now());
            if (totals.leftMs + totals.rightMs > 0) {
              const minutes = timerMinutes(totals);
              draft.values.leftDuration = String(minutes.left); draft.values.rightDuration = String(minutes.right);
            }
          }
        }
        draft.revision++; draft.updatedAtMs = now(); return draft;
      });
    },
    async assertGeneration(generation: string) {
      const state = await store.read();
      if (state.restore || generation !== state.generation) throw new DraftStateError('资料已恢复，请重新打开记录页');
    },
    async resolveInterruptedRestore() {
      return change((state) => {
        if (state.restore) { state.generation = createId(); state.restore = null; }
      });
    },
    async beginRestore(id: string) {
      return change((state) => {
        if (state.restore) throw new DraftStateError('请先核对上次恢复留下的草稿');
        for (const draft of Object.values(state.drafts)) {
          if (draft.timer && !draft.timer.finished) draft.timer = transitionTimer(draft.timer, { type: 'pause' }, now());
        }
        state.restore = { id, previousGeneration: state.generation };
      });
    },
    async endRestore(id: string, committed: boolean) {
      return change((state) => {
        if (state.restore?.id !== id) throw new DraftStateError('恢复操作标识不一致');
        if (committed) { state.generation = createId(); state.drafts = {}; }
        state.restore = null;
      });
    },
  };
}
export type RecordDraftService = ReturnType<typeof createRecordDraftService>;
