import { useDraftField } from '@/features/records/hooks/use-record-draft';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { RecordDateTimeField, RecordDateHint } from '@/components/ui/record-date-time-field';
import { Spacing } from '@/constants/theme';
import type { OtherCoreInput } from '@/domain/other/other';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type Props = {
  initialInput: OtherCoreInput;
  clientRequestId: string | null;
  headerSubtitle?: string;
  submitLabel?: string;
  onSave(input: OtherCoreInput, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

const TITLE_SUGGESTIONS = ['洗澡', '吃维生素', '打嗝', '吐奶', '测体温'] as const;

export function createOtherSubmissionLock() {
  let active = false;
  return {
    async run(task: () => Promise<void>) {
      if (active) return false;
      active = true;
      try {
        await task();
        return true;
      } finally {
        active = false;
      }
    },
  };
}

export function OtherForm({
  initialInput,
  clientRequestId,
  headerSubtitle,
  submitLabel = '保存记录',
  onSave,
  onDelete,
}: Props) {
  const submissionLock = useRef(createOtherSubmissionLock());
  const [eventTimeMs, setEventTimeMs] = useDraftField('eventTimeMs', initialInput.eventTimeMs);
  const [title, setTitle] = useDraftField('title', initialInput.title);
  const [note, setNote] = useDraftField('note', initialInput.note ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = async () => {
    await submissionLock.current.run(async () => {
      setSaving(true);
      setErrorMessage(null);
      try {
        await onSave({ eventTimeMs, title, note: note || null }, clientRequestId);
      } catch (error) {
        setErrorMessage(toSafeUiMessage(error, '保存失败，请检查填写内容后重试。'));
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <FormScreen
      title="记录其他事项"
      subtitle={headerSubtitle}
      icon="other"
      footer={(
        <>
          <RecordDateHint valueMs={eventTimeMs} />
          <AppButton accessibilityLabel="保存其他记录" label={submitLabel} loading={saving} onPress={() => { void handleSave(); }} />
          {onDelete ? <AppButton accessibilityLabel="删除其他记录" disabled={saving} label="删除记录" onPress={onDelete} variant="destructive-ghost" /> : null}
        </>
      )}>
        <RecordDateTimeField
          label="发生时间"
          valueMs={eventTimeMs}
          onChange={setEventTimeMs}
          maximumDate={new Date()}
          dateAccessibilityLabel="修改记录日期"
          timeAccessibilityLabel="修改记录时间"
        />

        <FormField label="常用标题" optional>
          <View style={styles.suggestions}>
            {TITLE_SUGGESTIONS.map((suggestion) => (
              <ChoiceChip
                key={suggestion}
                accessibilityLabel={`快捷标题 ${suggestion}`}
                label={suggestion}
                onPress={() => setTitle(suggestion)}
                selected={title === suggestion}
                style={styles.suggestion}
              />
            ))}
          </View>
        </FormField>

        <FormField error={errorMessage} label="标题">
          <AppTextInput
            accessibilityLabel="标题"
            autoFocus
            maxLength={30}
            onChangeText={setTitle}
            placeholder="例如：洗澡"
            returnKeyType="next"
            error={errorMessage}
            value={title}
          />
        </FormField>

        <FormField label="备注" optional>
          <AppTextInput
            accessibilityLabel="备注"
            maxLength={200}
            multiline
            onChangeText={setNote}
            placeholder="选填"
            value={note}
          />
        </FormField>

    </FormScreen>
  );
}

const styles = StyleSheet.create({
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  suggestion: { flexGrow: 1, minWidth: 88 },
});
