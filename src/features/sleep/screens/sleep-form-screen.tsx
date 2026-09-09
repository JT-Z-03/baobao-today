import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState as NativeAppState } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormScreenState } from '@/components/ui/form-screen-state';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { toLocalDateKey } from '@/domain/date/local-date';
import type { SleepRecord } from '@/domain/sleep/sleep';
import { SleepForm } from '@/features/sleep/components/sleep-form';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = { recordId?: string };

export function SleepFormScreen({ recordId }: Props) {
  const router = useRouter();
  const { babyProfile, sleepService } = useAppState();
  const [clientRequestId] = useState(() => recordId ? null : (sleepService?.createClientRequestId() ?? null));
  const [record, setRecord] = useState<SleepRecord | null>(null);
  const [newStartMs, setNewStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!sleepService) return;
    let active = true;
    const load = recordId
      ? sleepService.getById(recordId).then((existing) => {
          if (!existing) throw new Error('睡眠记录不存在或已被删除');
          if (active) setRecord(existing);
        })
      : sleepService.getActive().then((existing) => {
          if (!active) return;
          if (existing) {
            router.replace({ pathname: '/sleep/[id]', params: { id: existing.id } });
          } else {
            setNewStartMs(sleepService.getCurrentTimeMs());
          }
        });
    load.catch((error) => {
      if (active) setLoadError(toSafeUiMessage(error, '睡眠记录读取失败，请返回后重试。'));
    });
    return () => { active = false; };
  }, [recordId, router, sleepService]);

  useEffect(() => {
    if (record?.status !== 'sleeping') return;
    const refresh = () => setNowMs(Date.now());
    refresh();
    const timer = setInterval(refresh, 60_000);
    const subscription = NativeAppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [record?.status]);

  if (!sleepService) return null;
  if (loadError || (!recordId && newStartMs === null) || (recordId && !record)) {
    return <FormScreenState error={loadError} loadingMessage="正在读取睡眠记录" />;
  }

  const headerSubtitle = babyProfile
    ? `${babyProfile.name} · 出生第 ${calculateBirthDayNumber(babyProfile.birthDate, toLocalDateKey(nowMs))} 天`
    : undefined;

  if (!recordId && newStartMs !== null) {
    return (
      <SleepForm
        headerSubtitle={headerSubtitle}
        mode="new"
        nowMs={sleepService.getCurrentTimeMs()}
        initialValue={{ startMs: newStartMs, endMs: null, note: null }}
        onSave={async (value) => {
          if (!clientRequestId) throw new Error('新建请求标识缺失，请重新打开睡眠页面');
          await sleepService.start({ startMs: value.startMs, note: value.note }, clientRequestId);
          router.back();
        }}
      />
    );
  }

  const current = record!;
  const deleteMessage = current.status === 'sleeping'
    ? '确定删除正在进行的睡眠记录吗？删除后本次睡眠计时将停止。'
    : '确定删除这条睡眠记录吗？';
  const handleDelete = () => { setDeleteError(null); setDeleteVisible(true); };
  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await sleepService.delete(current.id);
      setDeleteVisible(false);
      router.back();
    } catch {
      setDeleteError('删除失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SleepForm
        headerSubtitle={headerSubtitle}
        mode={current.status === 'sleeping' ? 'active' : 'completed'}
        nowMs={nowMs}
        initialValue={{ startMs: current.startMs, endMs: current.endMs, note: current.note }}
        onSave={async (value) => {
          if (current.status === 'sleeping') {
            await sleepService.updateActive(current.id, { startMs: value.startMs, note: value.note });
          } else {
            if (value.endMs === null) throw new Error('结束时间不能为空');
            await sleepService.updateCompleted(current.id, {
              startMs: value.startMs, endMs: value.endMs, note: value.note,
            });
          }
          router.back();
        }}
        onFinish={current.status === 'sleeping' ? async (endMs) => {
          await sleepService.finishAt(current.id, endMs);
          router.back();
        } : undefined}
        onDelete={handleDelete}
      />
      <ConfirmDialog
        busy={deleting}
        confirmLabel="删除"
        error={deleteError}
        message={deleteMessage}
        onCancel={() => { if (!deleting) setDeleteVisible(false); }}
        onConfirm={() => { void confirmDelete(); }}
        title="删除睡眠记录"
        variant="destructive"
        visible={deleteVisible}
      />
    </>
  );
}
