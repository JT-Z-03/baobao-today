import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormScreenState } from '@/components/ui/form-screen-state';
import type { FeedingCreateInput } from '@/domain/feeding/feeding';
import { FeedingForm } from '@/features/feeding/components/feeding-form';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = { recordId?: string };

export function FeedingFormScreen({ recordId }: Props) {
  const router = useRouter();
  const { feedingService } = useAppState();
  const [clientRequestId] = useState(() =>
    recordId ? null : (feedingService?.createClientRequestId() ?? null),
  );
  const [initialInput, setInitialInput] = useState<FeedingCreateInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reminderWarning, setReminderWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!feedingService) return;
    let active = true;
    const load = recordId
      ? feedingService.getById(recordId).then((record) => {
          if (!record) throw new Error('喝奶记录不存在或已被删除');
          return {
            eventTimeMs: record.eventTimeMs,
            feedingType: record.feedingType,
            milkAmountMl: record.milkAmountMl,
            breastMilkAmountMl: record.breastMilkAmountMl,
            leftDurationMin: record.leftDurationMin,
            rightDurationMin: record.rightDurationMin,
            note: record.note,
          } satisfies FeedingCreateInput;
        })
      : feedingService.getNewRecordDefaults().then((defaults) => ({
          eventTimeMs: defaults.eventTimeMs,
          feedingType: defaults.feedingType,
          milkAmountMl: defaults.milkAmountMl,
          breastMilkAmountMl: defaults.breastMilkAmountMl,
          leftDurationMin: defaults.feedingType === 'breast' || defaults.feedingType === 'mixed' ? 0 : null,
          rightDurationMin: defaults.feedingType === 'breast' || defaults.feedingType === 'mixed' ? 0 : null,
          note: null,
        }) satisfies FeedingCreateInput);

    load
      .then((input) => {
        if (active) setInitialInput(input);
      })
      .catch((error) => {
        if (active) setLoadError(toSafeUiMessage(error, '喝奶记录读取失败，请返回后重试。'));
      });
    return () => {
      active = false;
    };
  }, [feedingService, recordId]);

  if (!feedingService) return null;
  if (loadError || !initialInput) return <FormScreenState error={loadError} loadingMessage="正在读取喝奶记录" />;

  const handleSave = async (input: FeedingCreateInput, stableClientRequestId: string | null) => {
    let reminderStatus;
    if (recordId) {
      ({ reminderStatus } = await feedingService.update(recordId, input));
    } else {
      if (!stableClientRequestId) throw new Error('新建请求标识缺失，请重新打开记录页面');
      ({ reminderStatus } = await feedingService.create(input, stableClientRequestId));
    }
    if (reminderStatus?.kind === 'sync-error') {
      setReminderWarning(recordId
        ? '记录已更新，但提醒更新失败。请稍后在设置中重试。'
        : '记录已保存，但提醒更新失败。请稍后在设置中重试。');
      return;
    }
    router.back();
  };

  const handleDelete = recordId ? () => { setDeleteError(null); setDeleteVisible(true); } : undefined;
  const confirmDelete = async () => {
    if (!recordId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { reminderStatus } = await feedingService.delete(recordId);
      setDeleteVisible(false);
      if (reminderStatus?.kind === 'sync-error') {
        setReminderWarning('记录已删除，但提醒更新失败。请稍后在设置中重试。');
      } else {
        router.back();
      }
    } catch {
      setDeleteError('删除失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <FeedingForm
        initialInput={initialInput}
        clientRequestId={clientRequestId}
        submitLabel={recordId ? '保存修改' : '完成'}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <ConfirmDialog
        busy={deleting}
        confirmLabel="删除"
        error={deleteError}
        message="确定删除这条喝奶记录吗？"
        onCancel={() => { if (!deleting) setDeleteVisible(false); }}
        onConfirm={() => { void confirmDelete(); }}
        title="删除喝奶记录"
        variant="destructive"
        visible={deleteVisible}
      />
      <ConfirmDialog
        cancelLabel={null}
        confirmLabel="返回"
        message={reminderWarning ?? ''}
        onCancel={() => router.back()}
        onConfirm={() => router.back()}
        title="提醒更新失败"
        visible={reminderWarning !== null}
      />
    </>
  );
}
