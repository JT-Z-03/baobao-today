import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormScreenState } from '@/components/ui/form-screen-state';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { toLocalDateKey } from '@/domain/date/local-date';
import type { OtherCoreInput } from '@/domain/other/other';
import { OtherForm } from '@/features/other/components/other-form';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = { recordId?: string };

export function OtherFormScreen({ recordId }: Props) {
  const router = useRouter();
  const { babyProfile, otherService } = useAppState();
  const [clientRequestId] = useState(() => recordId ? null : (otherService?.createClientRequestId() ?? null));
  const [initialInput, setInitialInput] = useState<OtherCoreInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!otherService) return;
    let active = true;
    const load = recordId
      ? otherService.getById(recordId).then((record) => {
          if (!record) throw new Error('记录不存在或已被删除');
          return {
            eventTimeMs: record.eventTimeMs,
            title: record.title,
            note: record.note,
          } satisfies OtherCoreInput;
        })
      : Promise.resolve({
          eventTimeMs: otherService.getCurrentTimeMs(),
          title: '',
          note: null,
        } satisfies OtherCoreInput);

    load.then((input) => { if (active) setInitialInput(input); })
      .catch((error) => { if (active) setLoadError(toSafeUiMessage(error, '记录读取失败，请返回后重试。')); });
    return () => { active = false; };
  }, [otherService, recordId]);

  if (!otherService) return null;
  if (loadError || !initialInput) return <FormScreenState error={loadError} loadingMessage="正在读取其他记录" />;

  const handleSave = async (input: OtherCoreInput, stableRequestId: string | null) => {
    if (recordId) {
      await otherService.update(recordId, input);
    } else {
      if (!stableRequestId) throw new Error('新建请求标识缺失，请重新打开记录页面');
      await otherService.create(input, stableRequestId);
    }
    router.back();
  };

  const handleDelete = recordId ? () => { setDeleteError(null); setDeleteVisible(true); } : undefined;
  const confirmDelete = async () => {
    if (!recordId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await otherService.delete(recordId);
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
      <OtherForm
        headerSubtitle={babyProfile ? `${babyProfile.name} · 出生第 ${calculateBirthDayNumber(babyProfile.birthDate, toLocalDateKey(otherService.getCurrentTimeMs()))} 天` : undefined}
        initialInput={initialInput}
        clientRequestId={clientRequestId}
        submitLabel={recordId ? '保存修改' : '保存记录'}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <ConfirmDialog
        busy={deleting}
        confirmLabel="删除"
        error={deleteError}
        message="确定删除这条记录吗？"
        onCancel={() => { if (!deleting) setDeleteVisible(false); }}
        onConfirm={() => { void confirmDelete(); }}
        title="删除记录"
        variant="destructive"
        visible={deleteVisible}
      />
    </>
  );
}
