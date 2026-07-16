import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppTextInput } from '@/components/ui/app-text-input';
import { FormField } from '@/components/ui/form-field';
import { keyboardAvoidingBehavior, useFormKeyboardVerticalOffset } from '@/components/ui/keyboard-behavior';
import { SectionCard } from '@/components/ui/section-card';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { formatSleepClock, formatSleepDuration } from '@/features/sleep/sleep-format';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

export type SleepFormValue = { startMs: number; endMs: number | null; note: string | null };
type Mode = 'new' | 'active' | 'completed';
type Picker = { field: 'start' | 'end'; mode: 'date' | 'time' } | null;

type Props = {
  mode: Mode;
  initialValue: SleepFormValue;
  nowMs: number;
  onSave(value: SleepFormValue): Promise<void>;
  onFinish?: (endMs: number) => Promise<void>;
  onDelete?: () => void;
};

function updateDatePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(),
    current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds()).getTime();
}

function updateTimePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(current.getFullYear(), current.getMonth(), current.getDate(),
    selected.getHours(), selected.getMinutes(), 0, 0).getTime();
}

function formatDate(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function createSleepActionLock() {
  let active = false;
  return async (task: () => Promise<void>) => {
    if (active) return;
    active = true;
    try { await task(); } finally { active = false; }
  };
}

export function SleepForm({ mode, initialValue, nowMs, onSave, onFinish, onDelete }: Props) {
  const theme = useTheme();
  const keyboardVerticalOffset = useFormKeyboardVerticalOffset();
  const lock = useRef(createSleepActionLock());
  const [startMs, setStartMs] = useState(initialValue.startMs);
  const [endMs, setEndMs] = useState(initialValue.endMs);
  const [note, setNote] = useState(initialValue.note ?? '');
  const [picker, setPicker] = useState<Picker>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  const setField = (field: 'start' | 'end', value: number) => {
    if (field === 'start') setStartMs(value);
    else setEndMs(value);
  };
  const fieldValue = picker?.field === 'end' ? (endMs ?? nowMs) : startMs;
  const handlePicker = (_event: DateTimePickerChangeEvent, selected: Date) => {
    const currentPicker = picker;
    setPicker(null);
    if (!currentPicker) return;
    const current = currentPicker.field === 'end' ? (endMs ?? nowMs) : startMs;
    setField(currentPicker.field, currentPicker.mode === 'date'
      ? updateDatePart(current, selected) : updateTimePart(current, selected));
  };
  const runAction = (task: () => Promise<void>) => lock.current(async () => {
    setSaving(true);
    setErrorMessage(null);
    try { await task(); }
    catch (error) { setErrorMessage(toSafeUiMessage(error, '保存失败，请检查时间后重试。')); }
    finally { setSaving(false); }
  });
  const renderTimeField = (field: 'start' | 'end', value: number, label: string) => (
    <FormField label={label}>
      <View style={styles.timeRow}>
        <Pressable
          accessibilityLabel={`修改${label.replace(/时间$/, '')}日期`}
          accessibilityRole="button"
          onPress={() => setPicker({ field, mode: 'date' })}
          style={[styles.timeButton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText numberOfLines={2}>{formatDate(value)}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel={`修改${label}`}
          accessibilityRole="button"
          onPress={() => setPicker({ field, mode: 'time' })}
          style={[styles.clockButton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText style={styles.clockText}>{formatSleepClock(value)}</ThemedText>
        </Pressable>
      </View>
    </FormField>
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={keyboardAvoidingBehavior()}
      keyboardVerticalOffset={keyboardVerticalOffset}>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}>
        {mode === 'active' && (
          <SectionCard style={[styles.activePanel, { backgroundColor: theme.sleepContainer, borderColor: theme.sleep }]}>
            <ThemedText type="small" themeColor="textSecondary">宝宝正在睡觉</ThemedText>
            <ThemedText style={styles.elapsed} selectable>已睡 {formatSleepDuration(nowMs - startMs)}</ThemedText>
          </SectionCard>
        )}

        {renderTimeField('start', startMs, '开始时间')}
        {mode === 'completed' && endMs !== null && renderTimeField('end', endMs, '结束时间')}
        {mode === 'completed' && endMs !== null && (
          <ThemedText themeColor="textSecondary" selectable>
            睡眠 {formatSleepDuration(endMs - startMs)}
          </ThemedText>
        )}
        {mode === 'active' && confirmingFinish && endMs !== null && (
          <>
            {renderTimeField('end', endMs, '结束时间')}
            <ThemedText themeColor="textSecondary" selectable>
              睡眠 {formatSleepDuration(endMs - startMs)}
            </ThemedText>
          </>
        )}
        {picker && (
          <DateTimePicker
            value={new Date(fieldValue)}
            mode={picker.mode}
            display="default"
            is24Hour
            maximumDate={picker.mode === 'date' ? new Date(nowMs) : undefined}
            onValueChange={handlePicker}
            onDismiss={() => setPicker(null)}
          />
        )}

        <FormField label="备注" optional>
          <AppTextInput
            accessibilityLabel="睡眠备注"
            maxLength={200}
            multiline
            onChangeText={setNote}
            placeholder="选填"
            value={note}
          />
        </FormField>

        {errorMessage && <ThemedText themeColor="danger" selectable>{errorMessage}</ThemedText>}

        {mode === 'active' && onFinish && !confirmingFinish && (
          <AppButton
            accessibilityLabel="宝宝醒了"
            disabled={saving}
            label="醒了"
            onPress={() => {
              setEndMs(nowMs);
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
              onPress={() => { setConfirmingFinish(false); setEndMs(null); }}
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
            variant={mode === 'new' ? 'primary' : 'secondary'}
          />
        )}

        {onDelete && (
          <AppButton
            accessibilityLabel="删除睡眠记录"
            disabled={saving}
            label="删除记录"
            onPress={onDelete}
            variant="destructive"
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: 160, gap: Spacing.xl },
  activePanel: { borderWidth: 1 },
  elapsed: { ...Typography.keyNumber },
  timeRow: { flexDirection: 'row', gap: Spacing.sm },
  timeButton: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: Spacing.md, justifyContent: 'center' },
  clockButton: { width: 112, minHeight: 52, borderWidth: 1, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center' },
  clockText: { fontVariant: ['tabular-nums'] },
});
