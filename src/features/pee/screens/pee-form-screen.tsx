import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormScreenState } from '@/components/ui/form-screen-state';
import type { PeeCoreInput } from '@/domain/pee/pee';
import { PeeForm } from '@/features/pee/components/pee-form';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = { recordId?: string };

export function PeeFormScreen({ recordId }: Props) {
  const router = useRouter();
  const { peeService } = useAppState();
  const [clientRequestId] = useState(() => recordId ? null : (peeService?.createClientRequestId() ?? null));
  const [initialInput, setInitialInput] = useState<PeeCoreInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!peeService) return;
    let active = true;
    const load = recordId
      ? peeService.getById(recordId).then((record) => {
          if (!record) throw new Error('小便记录不存在或已被删除');
          return {
            eventTimeMs: record.eventTimeMs,
            amount: record.amount,
            color: record.color,
            note: record.note,
          } satisfies PeeCoreInput;
        })
      : Promise.resolve({
          eventTimeMs: peeService.getCurrentTimeMs(),
          amount: null,
          color: null,
          note: null,
        } satisfies PeeCoreInput);

    load.then((input) => { if (active) setInitialInput(input); })
      .catch((error) => { if (active) setLoadError(toSafeUiMessage(error, '小便记录读取失败，请返回后重试。')); });
    return () => { active = false; };
  }, [peeService, recordId]);

  if (!peeService) return null;
  if (loadError || !initialInput) return <FormScreenState error={loadError} loadingMessage="正在读取小便记录" />;

  const handleSave = async (input: PeeCoreInput, stableRequestId: string | null) => {
    if (recordId) {
      await peeService.update(recordId, input);
    } else {
      if (!stableRequestId) throw new Error('新建请求标识缺失，请重新打开记录页面');
      await peeService.create(input, stableRequestId);
    }
    router.back();
  };

  const handleDelete = recordId ? () => { setDeleteError(null); setDeleteVisible(true); } : undefined;
  const confirmDelete = async () => {
    if (!recordId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await peeService.delete(recordId);
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
      <PeeForm
        initialInput={initialInput}
        clientRequestId={clientRequestId}
        submitLabel={recordId ? '保存修改' : '完成记录'}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <ConfirmDialog
        busy={deleting}
        confirmLabel="删除"
        error={deleteError}
        message="确定删除这条小便记录吗？"
        onCancel={() => { if (!deleting) setDeleteVisible(false); }}
        onConfirm={() => { void confirmDelete(); }}
        title="删除小便记录"
        variant="destructive"
        visible={deleteVisible}
      />
    </>
  );
}
