import { useLocalClock } from '@/hooks/use-local-clock';
import { useCallback, useEffect, useState } from 'react';
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

export function PendingRecordsEntry() {
  const app = useAppState();
  const { draftService, babyProfile, retryInitialization } = app; const router = useRouter();
  const nowMs = useLocalClock();
  const [state, setState] = useState<Awaited<ReturnType<RecordDraftService['list']>> | null>(null);
  const [selected, setSelected] = useState<RecordDraft | null>(null); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (draftService) void draftService.list().then(setState).catch(() => setError('未完成记录暂时无法读取，请稍后重试'));
  }, [draftService]);
  useEffect(() => { refresh(); return draftService?.subscribe(refresh); }, [draftService, refresh]);
  if (!draftService || (!state?.drafts.length && !state?.quarantined && !error)) return null;
  const open = async (draft: RecordDraft, quarantined: boolean) => {
    if (quarantined) { setSelected(draft); return; }
    try {
      const lookup = app[`${draft.kind}Service` as 'feedingService'];
      if (draft.recordId && lookup && !await lookup.getById(draft.recordId)) { setSelected(draft); return; }
      router.push(`/${draft.kind}/${draft.recordId ?? 'new'}` as Href);
    } catch { setError('暂时无法核对原记录，请稍后重试'); }
  };
  const recover = async () => {
    if (!selected) return;
    try {
      const next = await draftService.recoverAsNew(selected.id, babyProfile?.id);
      setSelected(null); if (next.generation !== state?.generation) retryInitialization(); router.push(`/${next.kind}/new` as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复草稿失败'); }
  };
  return <View style={{ gap: Spacing.sm }}>
    <ThemedText type="subtitle">继续未完成记录</ThemedText>
    {error ? <ThemedText themeColor="danger">{error}</ThemedText> : null}
    {state?.quarantined ? <><ThemedText>上次恢复被中断。请重新载入当前资料；旧草稿会保留供逐条核对。</ThemedText><AppButton label="重新载入当前资料" onPress={() => { void draftService.resolveInterruptedRestore().then(retryInitialization).catch(() => setError("重新载入失败，请重试")); }} /></> : null}
    {state?.drafts.map((draft) => {
      const quarantined = state.quarantined || draft.generation !== state.generation || draft.babyId !== babyProfile?.id;
      const name = !quarantined && draft.timer && !draft.timer.finished ? (draft.timer.side ? '亲喂计时中' : '亲喂计时已暂停')
        : `${RECORD_KIND_LABELS[draft.kind]}${draft.recordId ? '修改' : '记录'}${quarantined ? ' · 旧草稿需核对' : ''}`;
      return <AppButton key={draft.id} variant="secondary" label={`${name} · ${formatRecordTime(draft.updatedAtMs, nowMs)}`}
        onPress={() => { void open(draft, quarantined); }} />;
    })}
    {selected ? <View style={{ gap: Spacing.sm }}>
      <ThemedText>旧{RECORD_KIND_LABELS[selected.kind]}草稿：{formatRecordTime('eventTimeMs' in selected.values ? selected.values.eventTimeMs : selected.values.startMs, nowMs)}</ThemedText>
      <ThemedText>{selected.values.note || '没有备注'}。恢复为新草稿后，请重新核对宝宝、日期和内容。</ThemedText>
      <AppButton label="作为新草稿恢复" onPress={() => { void recover(); }} />
      <AppButton label="放弃这条旧草稿" variant="secondary" onPress={() => {
        void draftService.discard(selected.id).then(async (removed) => {
          if (removed?.kind === 'poop' && removed.values.photoChange.kind === 'replace') await new ExpoDraftAttachmentStore().remove(removed.values.photoChange.source.uri);
          setSelected(null); if (state?.quarantined) retryInitialization();
        }).catch(() => setError('放弃失败，请重试'));
      }} />
      <AppButton label="暂时保留" variant="secondary" onPress={() => setSelected(null)} />
    </View> : null}
  </View>;
}
