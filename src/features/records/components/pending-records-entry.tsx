import { useLocalClock } from '@/hooks/use-local-clock';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAppState } from '@/application/app-state/app-state-provider';
import type { RecordDraftService } from '@/application/drafts/record-draft-service';
import { RECORD_KIND_LABELS, type RecordDraft } from '@/domain/drafts/record-draft';
import { formatRecordTime } from '@/domain/date/record-time-shortcuts';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { ExpoDraftAttachmentStore } from '@/data/workflow/expo-draft-attachment-store';
import { Spacing } from '@/constants/theme';

type DiscardRecovery = {
  draft: RecordDraft;
  pendingRefresh: boolean;
  committed: boolean;
  busy: boolean;
  error: string | null;
};

function createDiscardRecoveryStore() {
  let snapshot: DiscardRecovery | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: DiscardRecovery | null) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

// A committed discard can outlive the home dashboard that displayed it.
// Scope only its unfinished recovery to the current Provider's draft service.
const discardRecoveryStores = new WeakMap<RecordDraftService, ReturnType<typeof createDiscardRecoveryStore>>();
const emptyDiscardRecoveryStore = createDiscardRecoveryStore();
function getDiscardRecoveryStore(service: RecordDraftService | null) {
  if (!service) return emptyDiscardRecoveryStore;
  let store = discardRecoveryStores.get(service);
  if (!store) {
    store = createDiscardRecoveryStore();
    discardRecoveryStores.set(service, store);
  }
  return store;
}

export function PendingRecordsEntry() {
  const app = useAppState();
  const { draftService, babyProfile, retryInitialization } = app; const router = useRouter();
  const nowMs = useLocalClock();
  const [state, setState] = useState<Awaited<ReturnType<RecordDraftService['list']>> | null>(null);
  const [localSelected, setSelected] = useState<RecordDraft | null>(null); const [localError, setError] = useState<string | null>(null);
  const recoveryStore = getDiscardRecoveryStore(draftService);
  const recovery = useSyncExternalStore(recoveryStore.subscribe, recoveryStore.getSnapshot, recoveryStore.getSnapshot);
  const selected = recovery?.draft ?? localSelected;
  const error = recovery?.error ?? localError;
  const discardBusy = !!recovery?.busy;
  const discardCommitted = !!recovery?.committed;
  const refresh = useCallback(() => {
    if (draftService) void draftService.list().then(setState).catch(() => setError('未完成记录暂时无法读取，请稍后重试'));
  }, [draftService]);
  useEffect(() => { refresh(); return draftService?.subscribe(refresh); }, [draftService, refresh]);
  if (!draftService || (!state?.drafts.length && !state?.quarantined && !error && !selected)) return null;
  const open = async (draft: RecordDraft, quarantined: boolean) => {
    if (recoveryStore.getSnapshot()?.busy || recoveryStore.getSnapshot()?.committed) return;
    recoveryStore.set(null); setSelected(null);
    if (quarantined) { setSelected(draft); return; }
    try {
      const lookup = app[`${draft.kind}Service` as 'feedingService'];
      if (draft.recordId && lookup && !await lookup.getById(draft.recordId)) { setSelected(draft); return; }
      router.push(`/${draft.kind}/${draft.recordId ?? 'new'}` as Href);
    } catch { setError('暂时无法核对原记录，请稍后重试'); }
  };
  const recover = async () => {
    if (!selected || recoveryStore.getSnapshot()?.busy || recoveryStore.getSnapshot()?.committed) return;
    setSelected(selected); recoveryStore.set(null);
    try {
      const next = await draftService.recoverAsNew(selected.id, babyProfile?.id);
      setSelected(null); if (next.generation !== state?.generation) retryInitialization(); router.push(`/${next.kind}/new` as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复草稿失败'); }
  };
  const discard = async () => {
    const prior = recoveryStore.getSnapshot();
    if (!selected || prior?.busy) return;
    recoveryStore.set({ ...(prior ?? { draft: selected, pendingRefresh: false, committed: false, error: null }), busy: true });
    try {
      const result = await draftService.discardWithGeneration(selected.id);
      // Keep the reload obligation after commit, even when photo cleanup fails and the list changes.
      recoveryStore.set({ ...recoveryStore.getSnapshot()!,
        pendingRefresh: !!recoveryStore.getSnapshot()?.pendingRefresh || result.generationChanged || !!state?.quarantined,
        committed: true });
      const removed = result.draft;
      if (removed?.kind === 'poop' && removed.values.photoChange.kind === 'replace') await new ExpoDraftAttachmentStore().remove(removed.values.photoChange.source.uri);
      if (recoveryStore.getSnapshot()?.pendingRefresh) retryInitialization();
      recoveryStore.set(null); setSelected(null); setError(null);
    } catch {
      const failed = recoveryStore.getSnapshot();
      if (failed) recoveryStore.set({ ...failed, error: '放弃失败，请重试', busy: false });
    } finally {
      const unfinished = recoveryStore.getSnapshot();
      if (unfinished?.busy) recoveryStore.set({ ...unfinished, busy: false });
    }
  };
  return <View style={{ gap: Spacing.sm }}>
    <ThemedText type="subtitle">继续未完成记录</ThemedText>
    {error ? <ThemedText themeColor="danger">{error}</ThemedText> : null}
    {error && discardCommitted ? <ThemedText>这条草稿已经放弃，后续处理未完成；请重试重新载入当前资料。</ThemedText> : null}
    {state?.quarantined ? <><ThemedText>上次恢复被中断。请重新载入当前资料；旧草稿会保留供逐条核对。</ThemedText><AppButton label="重新载入当前资料" disabled={discardBusy || discardCommitted} onPress={() => { if (recoveryStore.getSnapshot()?.busy || recoveryStore.getSnapshot()?.committed) return; void draftService.resolveInterruptedRestore().then(retryInitialization).catch(() => setError("重新载入失败，请重试")); }} /></> : null}
    {state?.drafts.map((draft) => {
      const quarantined = state.quarantined || draft.generation !== state.generation || draft.babyId !== babyProfile?.id;
      const name = !quarantined && draft.timer && !draft.timer.finished ? (draft.timer.side ? '亲喂计时中' : '亲喂计时已暂停')
        : `${RECORD_KIND_LABELS[draft.kind]}${draft.recordId ? '修改' : '记录'}${quarantined ? ' · 旧草稿需核对' : ''}`;
      return <AppButton key={draft.id} variant="secondary" label={`${name} · ${formatRecordTime(draft.updatedAtMs, nowMs)}`} disabled={discardBusy || discardCommitted}
        onPress={() => { void open(draft, quarantined); }} />;
    })}
    {selected ? <View style={{ gap: Spacing.sm }}>
      <ThemedText>旧{RECORD_KIND_LABELS[selected.kind]}草稿：{formatRecordTime('eventTimeMs' in selected.values ? selected.values.eventTimeMs : selected.values.startMs, nowMs)}</ThemedText>
      <ThemedText>{selected.values.note || '没有备注'}。恢复为新草稿后，请重新核对宝宝、日期和内容。</ThemedText>
      <AppButton label="作为新草稿恢复" disabled={discardBusy || discardCommitted} onPress={() => { void recover(); }} />
      <AppButton label="放弃这条旧草稿" variant="secondary" loading={discardBusy} onPress={() => { void discard(); }} />
      <AppButton label="暂时保留" variant="secondary" disabled={discardBusy || discardCommitted} onPress={() => { if (!recoveryStore.getSnapshot()?.busy && !recoveryStore.getSnapshot()?.committed) { recoveryStore.set(null); setSelected(null); } }} />
    </View> : null}
  </View>;
}
