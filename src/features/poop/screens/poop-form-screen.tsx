import { discardDeletedDraft } from '@/features/records/discard-deleted-draft';
import { RecordDraftBoundary } from '@/features/records/components/record-draft-boundary';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormScreenState } from '@/components/ui/form-screen-state';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { toLocalDateKey } from '@/domain/date/local-date';
import type { PoopCoreInput, PoopPhotoChange } from '@/domain/poop/poop';
import { PoopForm } from '@/features/poop/components/poop-form';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = { recordId?: string };
type InitialState = { input: PoopCoreInput; photoPreviewUri: string | null; hasPhoto: boolean };

export function PoopFormScreen({ recordId }: Props) {
  const router = useRouter();
  const { babyProfile, poopService, draftService } = useAppState();
  const [clientRequestId] = useState(() => recordId ? null : (poopService?.createClientRequestId() ?? null));
  const [initial, setInitial] = useState<InitialState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!poopService) return;
    let active = true;
    const load = recordId
      ? poopService.getById(recordId).then(async (record) => {
          if (!record) throw new Error('大便记录不存在或已被删除');
          return {
            input: {
              eventTimeMs: record.eventTimeMs,
              color: record.color,
              texture: record.texture,
              amount: record.amount,
              note: record.note,
            },
            photoPreviewUri: record.photoUri ? await poopService.resolvePhoto(record.photoUri) : null,
            hasPhoto: record.photoUri !== null,
          } satisfies InitialState;
        })
      : Promise.resolve({
          input: { eventTimeMs: poopService.getCurrentTimeMs(), color: null, texture: null, amount: null, note: null },
          photoPreviewUri: null,
          hasPhoto: false,
        } satisfies InitialState);

    load.then((result) => { if (active) setInitial(result); })
      .catch((error) => { if (active) setLoadError(toSafeUiMessage(error, '大便记录读取失败，请返回后重试。')); });
    return () => { active = false; };
  }, [poopService, recordId]);

  if (!poopService) return null;
  if (loadError || !initial) return <FormScreenState error={loadError} loadingMessage="正在读取大便记录" />;

  const handleSave = async (input: PoopCoreInput, photoChange: PoopPhotoChange, stableRequestId: string | null) => {
    if (recordId) {
      await poopService.update(recordId, { ...input, photoChange });
    } else {
      if (!stableRequestId) throw new Error('新建请求标识缺失，请重新打开记录页面');
      await poopService.create({ ...input, photo: photoChange.kind === 'replace' ? photoChange.source : null }, stableRequestId);
    }
  };

  const handleDelete = recordId ? () => { setDeleteError(null); setDeleteVisible(true); } : undefined;
  const confirmDelete = async () => {
    if (!recordId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await poopService.delete(recordId);
      await discardDeletedDraft(draftService, babyProfile?.id, 'poop', recordId);
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
      <RecordDraftBoundary kind="poop" recordId={recordId}>
      <PoopForm
        headerSubtitle={babyProfile ? `${babyProfile.name} · 出生第 ${calculateBirthDayNumber(babyProfile.birthDate, toLocalDateKey(poopService.getCurrentTimeMs()))} 天` : undefined}
        initialInput={initial.input}
        initialPhotoPreviewUri={initial.photoPreviewUri}
        hasInitialPhoto={initial.hasPhoto}
        clientRequestId={clientRequestId}
        submitLabel={recordId ? '保存修改' : '保存记录'}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      </RecordDraftBoundary>
      <ConfirmDialog
        busy={deleting}
        confirmLabel="删除"
        error={deleteError}
        message="确定删除这条大便记录吗？"
        onCancel={() => { if (!deleting) setDeleteVisible(false); }}
        onConfirm={() => { void confirmDelete(); }}
        title="删除大便记录"
        variant="destructive"
        visible={deleteVisible}
      />
    </>
  );
}
