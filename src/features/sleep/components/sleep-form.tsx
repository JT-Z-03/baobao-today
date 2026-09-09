import { useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIllustration } from '@/components/ui/app-illustration';
import { AppTextInput } from '@/components/ui/app-text-input';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { RecordDateTimeField } from '@/components/ui/record-date-time-field';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { SleepValidationError } from '@/domain/sleep/sleep-validation';
import { formatSleepClock, formatSleepDuration } from '@/features/sleep/sleep-format';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

export type SleepFormValue = { startMs: number; endMs: number | null; note: string | null };
type Mode = 'new' | 'active' | 'completed';
type ErrorField = 'start' | 'end' | 'note';

type Props = {
  mode: Mode;
  initialValue: SleepFormValue;
  nowMs: number;
  headerSubtitle?: string;
  onSave(value: SleepFormValue): Promise<void>;
  onFinish?: (endMs: number) => Promise<void>;
  onDelete?: () => void;
};

export function createSleepActionLock() {
  let active = false;
  return async (task: () => Promise<void>) => {
    if (active) return;
    active = true;
    try { await task(); } finally { active = false; }
  };
}

export function SleepForm({ mode, initialValue, nowMs, headerSubtitle, onSave, onFinish, onDelete }: Props) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackedPanel = width < 360 || fontScale > 1.3;
  const lock = useRef(createSleepActionLock());
  const [startMs, setStartMs] = useState(initialValue.startMs);
  const [endMs, setEndMs] = useState(initialValue.endMs);
  const [note, setNote] = useState(initialValue.note ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ErrorField, string>>>({});
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  const clearFieldError = (field: ErrorField) => setFieldErrors((current) => {
    const { [field]: _removed, ...remaining } = current;
    return remaining;
  });
  const runAction = (task: () => Promise<void>) => lock.current(async () => {
    setSaving(true);
    setErrorMessage(null);
    setFieldErrors({});
    try { await task(); }
    catch (error) {
      if (error instanceof SleepValidationError) {
        const field = error.message.startsWith('开始时间') ? 'start'
          : error.message.startsWith('结束时间') ? 'end'
            : error.message.startsWith('备注') ? 'note' : null;
        if (field) setFieldErrors({ [field]: error.message });
        else setErrorMessage(toSafeUiMessage(error, '保存失败，请检查时间后重试。'));
      } else setErrorMessage(toSafeUiMessage(error, '保存失败，请检查时间后重试。'));
    }
    finally { setSaving(false); }
  });
  const renderTimeField = (field: 'start' | 'end', value: number, label: string) => (
    <RecordDateTimeField
      label={label}
      valueMs={value}
      error={fieldErrors[field]}
      maximumDate={new Date(nowMs)}
      dateAccessibilityLabel={`修改${label.replace(/时间$/, '')}日期`}
      timeAccessibilityLabel={`修改${label}`}
      onChange={(next) => {
        if (field === 'start') setStartMs(next);
        else setEndMs(next);
        clearFieldError(field);
      }}
    />
  );

  const footer = (
    <>
        {errorMessage && <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{errorMessage}</ThemedText>}
        {mode === 'active' && onFinish && !confirmingFinish && (
          <AppButton
            accessibilityLabel="宝宝醒了"
            disabled={saving}
            label="醒了"
            onPress={() => {
              setEndMs(nowMs);
              clearFieldError('end');
              setConfirmingFinish(true);
            }}
          />
        )}

        {mode === 'active' && onFinish && confirmingFinish && endMs !== null && (
          <>
            <AppButton
              accessibilityLabel="确认结束睡眠"
              label="确认结束睡眠"
              loading={saving}
              onPress={() => void runAction(() => onFinish(endMs))}
            />
            <AppButton
              accessibilityLabel="取消结束睡眠"
              disabled={saving}
              label="取消"
              onPress={() => {
                setConfirmingFinish(false);
                setEndMs(null);
                clearFieldError('end');
                setErrorMessage(null);
              }}
              variant="secondary"
            />
          </>
        )}

        {!(mode === 'active' && confirmingFinish) && (
          <AppButton
            accessibilityLabel={mode === 'new' ? '开始睡眠' : '保存睡眠修改'}
            label={mode === 'new' ? '开始睡眠' : '保存修改'}
            loading={saving}
            onPress={() => void runAction(() => onSave({ startMs, endMs, note: note || null }))}
            variant={mode === 'active' ? 'secondary' : 'primary'}
          />
        )}

        {onDelete && (
          <AppButton
            accessibilityLabel="删除睡眠记录"
            disabled={saving}
            label="删除记录"
            onPress={onDelete}
            variant="destructive-ghost"
          />
        )}
    </>
  );

  return (
    <FormScreen title="睡眠记录" subtitle={headerSubtitle} icon="sleep" footer={footer}>
      {mode === 'active' && (
        <View style={[styles.activePanel, { backgroundColor: theme.primaryContainer }, stackedPanel && styles.stackedPanel]}>
          <View style={styles.sleepSummary}>
            <ThemedText themeColor="textSecondary">宝宝正在睡觉</ThemedText>
            <ThemedText style={styles.elapsed} selectable>已睡 {formatSleepDuration(nowMs - startMs)}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.clockText}>{formatSleepClock(startMs)} 开始</ThemedText>
          </View>
          <View style={styles.illustration}>
            <AppIllustration name="babySleeping" width={112} height={80} />
          </View>
        </View>
      )}

      {renderTimeField('start', startMs, '开始时间')}
      {(mode === 'completed' || (mode === 'active' && confirmingFinish)) && endMs !== null && (
        <>
          {renderTimeField('end', endMs, '结束时间')}
          <ThemedText themeColor="textSecondary" selectable>本次睡眠 {formatSleepDuration(endMs - startMs)}</ThemedText>
        </>
      )}

      <FormField label="备注" optional error={fieldErrors.note}>
        <AppTextInput
          accessibilityLabel="睡眠备注"
          error={fieldErrors.note}
          maxLength={200}
          multiline
          onChangeText={(value) => { setNote(value); clearFieldError('note'); }}
          placeholder="选填"
          value={note}
        />
      </FormField>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  activePanel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.hero },
  stackedPanel: { flexDirection: 'column', alignItems: 'stretch' },
  sleepSummary: { flex: 1, minWidth: 0, gap: Spacing.md },
  illustration: { alignSelf: 'flex-end' },
  elapsed: { ...Typography.keyNumber },
  clockText: { fontVariant: ['tabular-nums'] },
});
