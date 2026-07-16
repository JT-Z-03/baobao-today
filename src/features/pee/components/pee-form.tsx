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
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { keyboardAvoidingBehavior, useFormKeyboardVerticalOffset } from '@/components/ui/keyboard-behavior';
import { Radius, Spacing } from '@/constants/theme';
import type { PeeAmount, PeeColor, PeeCoreInput } from '@/domain/pee/pee';
import { PEE_AMOUNT_LABELS, PEE_COLOR_LABELS } from '@/features/pee/pee-format';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  initialInput: PeeCoreInput;
  clientRequestId: string | null;
  submitLabel?: string;
  onSave(input: PeeCoreInput, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

type PickerMode = 'date' | 'time' | null;

export function createPeeSubmissionLock() {
  let active = false;
  return {
    async run(task: () => Promise<void>) {
      if (active) return false;
      active = true;
      try { await task(); return true; }
      finally { active = false; }
    },
  };
}

const amountOptions = Object.entries(PEE_AMOUNT_LABELS) as [PeeAmount, string][];
const colorOptions = Object.entries(PEE_COLOR_LABELS) as [PeeColor, string][];

function updateDatePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(
    selected.getFullYear(), selected.getMonth(), selected.getDate(),
    current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds(),
  ).getTime();
}

function updateTimePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(
    current.getFullYear(), current.getMonth(), current.getDate(),
    selected.getHours(), selected.getMinutes(), 0, 0,
  ).getTime();
}

function formatDate(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTime(ms: number) {
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

type ChoiceGroupProps<T extends string> = {
  title: string;
  accessibilityPrefix: string;
  value: T | null;
  options: readonly [T, string][];
  onChange(value: T | null): void;
};

function ChoiceGroup<T extends string>({
  title, accessibilityPrefix, value, options, onChange,
}: ChoiceGroupProps<T>) {
  return (
    <FormField label={title} optional>
      <View style={styles.choiceGrid}>
        {options.map(([option, label]) => {
          const selected = value === option;
          return (
            <ChoiceChip
              key={option}
              accessibilityLabel={`${accessibilityPrefix} ${label}`}
              label={label}
              onPress={() => onChange(selected ? null : option)}
              selected={selected}
            />
          );
        })}
      </View>
    </FormField>
  );
}

export function PeeForm({
  initialInput,
  clientRequestId,
  submitLabel = '完成记录',
  onSave,
  onDelete,
}: Props) {
  const theme = useTheme();
  const keyboardVerticalOffset = useFormKeyboardVerticalOffset();
  const submissionLock = useRef(createPeeSubmissionLock());
  const [eventTimeMs, setEventTimeMs] = useState(initialInput.eventTimeMs);
  const [amount, setAmount] = useState(initialInput.amount);
  const [color, setColor] = useState(initialInput.color);
  const [note, setNote] = useState(initialInput.note ?? '');
  const [expanded, setExpanded] = useState(
    initialInput.amount !== null || initialInput.color !== null || initialInput.note !== null,
  );
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePickerValueChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    const mode = pickerMode;
    if (!mode) return;
    setEventTimeMs((current) => mode === 'date'
      ? updateDatePart(current, selectedDate)
      : updateTimePart(current, selectedDate));
    setPickerMode(null);
  };

  const handleSave = async () => {
    await submissionLock.current.run(async () => {
      setSaving(true);
      setErrorMessage(null);
      try {
        await onSave({ eventTimeMs, amount, color, note: note || null }, clientRequestId);
      } catch (error) {
        setErrorMessage(toSafeUiMessage(error, '保存失败，请检查填写内容后重试。'));
      } finally {
        setSaving(false);
      }
    });
  };

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
        <FormField label="记录时间">
          <View style={styles.timeRow}>
            <Pressable
              accessibilityLabel="修改记录日期"
              accessibilityRole="button"
              onPress={() => setPickerMode('date')}
              style={[styles.timeButton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ThemedText numberOfLines={2}>{formatDate(eventTimeMs)}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityLabel="修改记录时间"
              accessibilityRole="button"
              onPress={() => setPickerMode('time')}
              style={[styles.timeButton, styles.clockButton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ThemedText style={styles.clockText}>{formatTime(eventTimeMs)}</ThemedText>
            </Pressable>
          </View>
          {pickerMode ? (
            <DateTimePicker
              value={new Date(eventTimeMs)}
              mode={pickerMode}
              display="default"
              is24Hour
              maximumDate={pickerMode === 'date' ? new Date() : undefined}
              onValueChange={handlePickerValueChange}
              onDismiss={() => setPickerMode(null)}
            />
          ) : null}
        </FormField>

        <Pressable
          accessibilityLabel={expanded ? '收起更多信息' : '展开更多信息'}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [
            styles.moreButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">更多信息</ThemedText>
          <ThemedText themeColor="textSecondary">{expanded ? '收起' : '展开'}</ThemedText>
        </Pressable>

        {expanded ? (
          <View style={styles.moreFields}>
            <ChoiceGroup<PeeAmount>
              title="尿量"
              accessibilityPrefix="选择尿量"
              value={amount}
              options={amountOptions}
              onChange={setAmount}
            />
            <ChoiceGroup<PeeColor>
              title="颜色"
              accessibilityPrefix="选择尿液颜色"
              value={color}
              options={colorOptions}
              onChange={setColor}
            />
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
          </View>
        ) : null}

        {errorMessage ? <ThemedText themeColor="danger" selectable>{errorMessage}</ThemedText> : null}
        <AppButton
          accessibilityLabel="保存小便记录"
          label={submitLabel}
          loading={saving}
          onPress={() => { void handleSave(); }}
        />
        {onDelete ? (
          <AppButton
            accessibilityLabel="删除小便记录"
            disabled={saving}
            label="删除记录"
            onPress={onDelete}
            variant="destructive"
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: 160, gap: Spacing.xl },
  timeRow: { flexDirection: 'row', gap: Spacing.sm },
  timeButton: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: Spacing.md, justifyContent: 'center' },
  clockButton: { flexBasis: 120, flexGrow: 0, flexShrink: 0, width: 120, alignItems: 'center' },
  clockText: { fontVariant: ['tabular-nums'] },
  moreButton: { minHeight: 52, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  moreFields: { gap: Spacing.xl },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pressed: { opacity: 0.7 },
});
