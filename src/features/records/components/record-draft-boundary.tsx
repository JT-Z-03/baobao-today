import { cloneElement, useCallback, useEffect, useRef, useState, type ReactElement, type ComponentType } from 'react';
import { AppState, View } from 'react-native';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useRouter, type Href } from 'expo-router';
import { useAppState } from '@/application/app-state/app-state-provider';
import type { RecordDraftService } from '@/application/drafts/record-draft-service';
import { createRecordSubmissionService, type SubmissionLookup } from '@/application/drafts/record-submission-service';
import { AppButton } from '@/components/ui/app-button';
import { ThemedText } from '@/components/themed-text';
import { FormScreenState } from '@/components/ui/form-screen-state';
import { ScreenContainer } from '@/components/ui/screen-container';
import { RECORD_KIND_LABELS, type RecordDraft, type RecordKind } from '@/domain/drafts/record-draft';
import { ExpoDraftAttachmentStore } from '@/data/workflow/expo-draft-attachment-store';
import { DraftFormContext, type DraftFormContextValue } from '../hooks/use-record-draft';
import { showRecordSaved } from './record-save-feedback';

type FormProps = { onSave: (...args: never[]) => Promise<unknown>; onFinish?: (endMs: number, changes?: { startMs: number; note: string | null }) => Promise<unknown>; clientRequestId?: string | null; onDelete?(): void };
type Props = { kind: RecordKind; recordId?: string; children: ReactElement<FormProps> };
function staysOnPage(value: unknown) { return !!value && typeof value === 'object' && 'stayOnPage' in value && value.stayOnPage === true; }

export function RecordDraftBoundary(props: Props) {
  const app = useAppState(); const router = useRouter();
  if (app.draftError) return <ScreenContainer><ThemedText>{app.draftError}</ThemedText><AppButton label="重试" onPress={app.retryInitialization} /></ScreenContainer>;
  // Existing isolated form tests and callers can still use the normal save path.
  if (!app.draftService || !app.babyProfile) return cloneElement(props.children, {
    onSave: async (...args: never[]) => { if (!staysOnPage(await props.children.props.onSave(...args))) router.back(); },
    ...(props.children.props.onFinish ? { onFinish: async (endMs: number, changes?: { startMs: number; note: string | null }) => { await props.children.props.onFinish?.(endMs, changes); router.back(); } } : {}),
  });
  const lookup = ({ feeding: app.feedingService, pee: app.peeService, poop: app.poopService, sleep: app.sleepService, other: app.otherService } satisfies Record<RecordKind, SubmissionLookup | null>)[props.kind];
  if (!lookup) return null;
  return <PersistentForm {...props} babyId={app.babyProfile.id} service={app.draftService} lookup={lookup} />;
}

function PersistentForm({ kind, recordId, children, babyId, service, lookup }: Props & {
  babyId: string; service: RecordDraftService; lookup: SubmissionLookup;
}) {
  const router = useRouter(); const navigation = useNavigation();
  const { retryInitialization } = useAppState();
  const [loaded, setLoaded] = useState(false); const [prompt, setPrompt] = useState<RecordDraft | null>(null);
  const [quarantined, setQuarantined] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false); const [revision, setRevision] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [draftView, setDraftView] = useState<RecordDraft | null>(null);
  const [restoredValues, setRestoredValues] = useState<Record<string, unknown>>({});
  const attachmentError = useRef<unknown>(null);
  const photoRequest = useRef(0);
  const values = useRef<Record<string, unknown>>({}); const draft = useRef<RecordDraft | null>(null);
  const baseRecord = useRef<Record<string, unknown> | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve()); const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useRef(false); const closed = useRef(false); const mounted = useRef(true);
  const pendingNavigation = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const attachments = useRef(new ExpoDraftAttachmentStore());
  const submission = useRef(createRecordSubmissionService(service));

  useEffect(() => {
    let active = true;
    void Promise.all([service.get({ babyId, kind, recordId }), recordId ? lookup.getById(recordId) : null])
      .then(([result, original]) => {
        if (!active) return;
        baseRecord.current = original as Record<string, unknown> | null;
        setPrompt(result.draft); setQuarantined(result.quarantined); setLoaded(true);
      }).catch(() => { if (active) setError('草稿读取失败，原内容已保留，请返回后重试'); });
    return () => { active = false; };
  }, [babyId, kind, recordId, service, lookup]);

  const flush = useCallback((force = false) => {
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    const task = pending.current.catch(() => undefined).then(async () => {
      if (closed.current || (!changed.current && (!force || draft.current))) return draft.current;
      if (attachmentError.current) throw attachmentError.current;
      const snapshot = JSON.parse(JSON.stringify(values.current)) as RecordDraft['values'];
      const current = draft.current;
      const saved = current ? await service.update(current.id, snapshot)
        : await service.create({ babyId, kind, recordId }, snapshot, baseRecord.current);
      draft.current = saved;
      if (mounted.current) setDraftView(saved);
      if (JSON.stringify(values.current) === JSON.stringify(snapshot)) changed.current = false;
      if (mounted.current) { setDirty(changed.current); setError(null); setMessage('草稿已保存在本机'); }
      return saved;
    });
    pending.current = task;
    return task;
  }, [babyId, kind, recordId, service]);

  const saveFailure = useCallback(() => { if (mounted.current) setError('草稿暂未保存，请重试；当前输入仍保留'); }, []);
  useEffect(() => {
    mounted.current = true; closed.current = false;
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') void flush().catch(saveFailure); });
    return () => { mounted.current = false; listener.remove(); void flush().catch(() => undefined).finally(() => { if (!mounted.current) closed.current = true; }); };
  }, [flush, saveFailure]);

  usePreventRemove(!leaving && dirty, ({ data }) => {
    pendingNavigation.current = data.action;
    void flush().then(() => setLeaving(true)).catch(saveFailure);
  });
  useEffect(() => {
    if (leaving && pendingNavigation.current) {
      const action = pendingNavigation.current; pendingNavigation.current = null; navigation.dispatch(action);
    }
  }, [leaving, navigation]);

  const adopt = (next: RecordDraft) => {
    draft.current = next; values.current = { ...next.values }; setDraftView(next); setRestoredValues({ ...next.values }); setRevision((value) => value + 1);
  };
  const context: DraftFormContextValue = {
    isNew: !recordId, locked: submitting, revision, values: restoredValues, draft: draftView,
    register(name, value) { if (!Object.hasOwn(values.current, name)) values.current[name] = value; },
    change(name, value) {
      if (closed.current) return;
      values.current[name] = value; changed.current = true; setDirty(true); setMessage(null);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => { void flush().catch(saveFailure); }, 300);
    },
    cancelPhoto() { photoRequest.current++; attachmentError.current = null; },
    photo(source) {
      const request = ++photoRequest.current;
      attachmentError.current = null; changed.current = true; setDirty(true);
      const operation = pending.current.catch(() => undefined).then(() => attachments.current.persist(source))
        .then(async (next) => {
          if (request !== photoRequest.current) { await attachments.current.remove(next.uri).catch(() => undefined); throw new Error('已取消选择照片'); }
          values.current.photoChange = { kind: 'replace', source: next }; values.current.previewUri = next.uri;
          if (mounted.current) { setRestoredValues({ ...values.current }); setRevision((value) => value + 1); }
          return next;
        }).catch((cause: unknown) => { if (request === photoRequest.current) attachmentError.current = cause; throw cause; });
      pending.current = operation;
      return operation;
    },
    async timer(action) {
      const current = await flush(true);
      if (!current) throw new Error('草稿尚未准备好');
      const before = { ...current.values } as Record<string, unknown>;
      const next = await service.timerAction(current.id, action);
      const newerInput = Object.fromEntries(Object.entries(values.current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
      const merged = { ...next, values: { ...next.values, ...newerInput } } as RecordDraft;
      adopt(merged);
      if (Object.keys(newerInput).length) { changed.current = true; setDirty(true); void flush().catch(saveFailure); }
      setMessage('计时已保存在本机'); return merged;
    },
  };

  const discard = async () => {
    if (debounce.current) clearTimeout(debounce.current);
    closed.current = true;
    await pending.current.catch(() => undefined);
    const current = prompt ?? draft.current;
    if (current) {
      await service.discard(current.id);
      if (current.kind === 'poop' && current.values.photoChange.kind === 'replace') {
        await attachments.current.remove(current.values.photoChange.source.uri).catch(() => undefined);
      }
    }
    draft.current = null; values.current = {}; setDraftView(null); setRestoredValues({}); changed.current = false; closed.current = false;
    attachmentError.current = null;
    setPrompt(null); setQuarantined(false); setConflict(false); setDirty(false); setError(null); setMessage(null);
    setRevision((value) => value + 1);
    setResetKey((value) => value + 1);
  };

  const resume = async () => {
    if (!prompt) return;
    try {
      if (quarantined) {
        const before = (await service.store.read()).generation;
        const next = await service.recoverAsNew(prompt.id, babyId);
        closed.current = true;
        if (next.generation !== before) retryInitialization();
        router.replace(`/${kind}/new` as Href); return;
      }
      const result = await submission.current.reconcile(prompt, lookup);
      if (result.kind === 'committed' && result.record) { showRecordSaved(kind, result.record); await service.discard(prompt.id); setPrompt(null); router.back(); return; }
      if (result.kind === 'conflict') { setConflict(true); setError('上次修改结果需要核对；请查看当前记录，草稿仍保留'); return; }
      const next = (await service.get({ babyId, kind, recordId })).draft;
      if (next) adopt(next); setPrompt(null); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '草稿恢复失败，请重试'); }
  };

  const runSave = async (args: unknown[], finish = false) => {
    if (closed.current || submitting) return;
    setSubmitting(true);
    try {
    const current = await flush(true);
    if (!current) throw new Error('草稿尚未准备好，请重试');
    if (current.timer && !current.timer.finished) throw new Error('请先结束亲喂计时并核对时长');
    const payload = { ...(args[0] as object) } as Record<string, unknown>;
    if (kind === 'poop' && current.kind === 'poop') {
      args[1] = current.values.photoChange;
      payload.photoChange = current.values.photoChange;
    }
    if (kind === 'sleep' && finish) { payload.startMs = values.current.startMs; payload.endMs = args[0]; }
    if (kind === 'sleep') { delete payload.note; payload.note = (values.current.note as string).trim() || null; }
    try {
      let stayOnPage = false;
      const saved = await submission.current.submit(current, payload, lookup, async (requestId) => {
        if (finish) return children.props.onFinish?.(args[0] as number, { startMs: payload.startMs as number, note: payload.note as string | null });
        const actual = [...args];
        if (kind === 'sleep') actual.push(requestId);
        else actual[actual.length - 1] = requestId;
        const result = await children.props.onSave(...actual as never[]);
        stayOnPage = staysOnPage(result);
        return result;
      });
      closed.current = true; changed.current = false; setDirty(false); setLeaving(true);
      showRecordSaved(kind, saved);
      await service.discard(current.id).catch(() => undefined);
      if (current.kind === 'poop' && current.values.photoChange.kind === 'replace') {
        await attachments.current.remove(current.values.photoChange.source.uri).catch(() => undefined);
      }
      if (!stayOnPage) router.back();
    } catch (cause) {
      const latest = await service.get({ babyId, kind, recordId });
      if (latest.draft) {
        draft.current = latest.draft;
        if (latest.draft.status === 'submitting') { setPrompt(latest.draft); setError('上次保存结果需要核对，请继续核对；原内容仍保留'); }
      }
      throw cause;
    }
    } finally { if (mounted.current) setSubmitting(false); }
  };

  const Form = children.type as ComponentType<FormProps>;
  if (!loaded) return <FormScreenState error={error} loadingMessage="正在读取本机草稿" />;
  if (prompt) return <ScreenContainer>
    <ThemedText type="title">{quarantined ? '旧草稿需核对' : `有一条未完成的${RECORD_KIND_LABELS[kind]}记录`}</ThemedText>
    <ThemedText>{quarantined ? '上次恢复被中断。旧内容不会自动写入当前资料，请核对日期和内容。' : '继续上次填写的内容，或放弃后重新记录。'}</ThemedText>
    {error ? <ThemedText themeColor="danger">{error}</ThemedText> : null}
    {conflict ? <AppButton label="作为新记录继续" onPress={() => { void service.recoverAsNew(prompt.id, babyId).then(() => { closed.current = true; router.replace(`/${kind}/new` as Href); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '恢复失败')); }} /> : null}
    {!conflict ? <AppButton label={quarantined ? '作为新草稿恢复' : '继续填写'} onPress={() => { void resume(); }} /> : null}
    <AppButton label="放弃草稿" variant="secondary" onPress={() => { void discard().catch(saveFailure); }} />
    <AppButton label="返回查看记录" variant="secondary" onPress={() => router.back()} />
  </ScreenContainer>;
  return <DraftFormContext value={context}>
    <View style={{ flex: 1 }} onBlur={() => { void flush().catch(saveFailure); }}>
      {message ? <ThemedText type="small" accessibilityLiveRegion="polite" style={{ padding: 8 }}>{message}</ThemedText> : null}
      {error ? <View style={{ padding: 8 }}><ThemedText themeColor="danger">{error}</ThemedText>
        <AppButton label="重试保存草稿" onPress={() => { void flush().catch(saveFailure); }} />
        <AppButton label="放弃本次内容" variant="secondary" onPress={() => { void discard().then(() => { setLeaving(true); router.back(); }).catch(saveFailure); }} />
      </View> : null}
      <View collapsable={false} style={{ flex: 1 }} pointerEvents={submitting ? 'none' : 'auto'}>
      <Form {...children.props} key={resetKey} onSave={(...args: never[]) => runSave(args)}
        onDelete={children.props.onDelete ? () => { void flush().then(() => children.props.onDelete?.()).catch(saveFailure); } : undefined}
        onFinish={children.props.onFinish ? (endMs: number) => runSave([endMs], true) : undefined} />
      </View>
    </View>
  </DraftFormContext>;
}
