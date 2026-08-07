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
import { AppIcon } from '@/components/ui/app-icon';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { keyboardAvoidingBehavior, useFormKeyboardVerticalOffset } from '@/components/ui/keyboard-behavior';
import { Radius, Spacing, Typography } from '@/constants/theme';
import {
  inferFeedingComponents,
  type FeedingComponent,
  type FeedingCreateInput,
  type FeedingType,
} from '@/domain/feeding/feeding';
import {
  FeedingValidationError,
  type FeedingValidationField,
} from '@/domain/feeding/feeding-validation';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  initialInput: FeedingCreateInput;
  clientRequestId: string | null;
  submitLabel?: string;
  onSave(input: FeedingCreateInput, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

type PickerMode = 'date' | 'time' | null;

export function createSubmissionLock() {
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

const typeOptions: readonly { value: FeedingType; label: string; accessibilityLabel: string }[] = [
  { value: 'formula', label: '奶粉', accessibilityLabel: '选择奶粉' },
  { value: 'breast', label: '亲喂母乳', accessibilityLabel: '选择亲喂母乳' },
  { value: 'bottle_breast', label: '瓶喂母乳', accessibilityLabel: '选择瓶喂母乳' },
  { value: 'mixed', label: '混合', accessibilityLabel: '选择混合' },
];

function toInputNumber(value: string) {
  return value === '' ? null : Number(value);
}

function updateDatePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(
    selected.getFullYear(),
    selected.getMonth(),
    selected.getDate(),
    current.getHours(),
    current.getMinutes(),
    current.getSeconds(),
    current.getMilliseconds(),
  ).getTime();
}

function updateTimePart(currentMs: number, selected: Date) {
  const current = new Date(currentMs);
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
    selected.getHours(),
    selected.getMinutes(),
    0,
    0,
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

type NumericFieldProps = {
  label: string;
  accessibilityLabel: string;
  value: string;
  suffix: string;
  step?: number;
  error?: string | null;
  onChange(value: string): void;
};

function NumericField({
  label,
  accessibilityLabel,
  value,
  suffix,
  step,
  error,
  onChange,
}: NumericFieldProps) {
  const theme = useTheme();
  const adjust = (delta: number) => {
    const current = /^\d+$/.test(value) ? Number(value) : 0;
    onChange(Math.max(0, current + delta).toString());
  };

  return (
    <FormField label={label} error={error}>
      <View style={styles.numberRow}>
        {step && (
          <Pressable
            accessibilityLabel={`${label}减少${step}`}
            accessibilityRole="button"
            onPress={() => adjust(-step)}
            style={({ pressed }) => [
              styles.stepButton,
              { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <AppIcon color={theme.textPrimary} name="remove" size={24} />
          </Pressable>
        )}
        <View style={styles.numberInputWrap}>
          <AppTextInput
            accessibilityLabel={accessibilityLabel}
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={(next) => {
              if (/^\d*$/.test(next)) onChange(next);
            }}
            selectTextOnFocus
            style={styles.numberInput}
            value={value}
          />
          <ThemedText pointerEvents="none" style={styles.numberSuffix} themeColor="textSecondary">{suffix}</ThemedText>
        </View>
        {step && (
          <Pressable
            accessibilityLabel={`${label}增加${step}`}
            accessibilityRole="button"
            onPress={() => adjust(step)}
            style={({ pressed }) => [
              styles.stepButton,
              { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <AppIcon color={theme.textPrimary} name="add" size={24} />
          </Pressable>
        )}
      </View>
    </FormField>
  );
}

export function FeedingForm({
  initialInput,
  clientRequestId,
  submitLabel = '完成',
  onSave,
  onDelete,
}: Props) {
  const theme = useTheme();
  const keyboardVerticalOffset = useFormKeyboardVerticalOffset();
  const submissionLock = useRef(createSubmissionLock());
  const [feedingType, setFeedingType] = useState(initialInput.feedingType);
  const [eventTimeMs, setEventTimeMs] = useState(initialInput.eventTimeMs);
  const [milkAmount, setMilkAmount] = useState(() => initialInput.milkAmountMl?.toString() ?? '');
  const [breastMilkAmount, setBreastMilkAmount] = useState(
    () => initialInput.breastMilkAmountMl?.toString() ?? '',
  );
  const [leftDuration, setLeftDuration] = useState(() => initialInput.leftDurationMin?.toString() ?? '0');
  const [rightDuration, setRightDuration] = useState(() => initialInput.rightDurationMin?.toString() ?? '0');
  const [mixedComponents, setMixedComponents] = useState<FeedingComponent[]>(
    () => inferFeedingComponents(initialInput),
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FeedingValidationField, string>>>({});
  const [note, setNote] = useState(initialInput.note ?? '');
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePickerChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    const mode = pickerMode;
    setPickerMode(null);
    if (!mode) return;
    clearFieldError('eventTimeMs');
    setEventTimeMs((current) =>
      mode === 'date' ? updateDatePart(current, selectedDate) : updateTimePart(current, selectedDate),
    );
  };

  const clearFieldError = (field: FeedingValidationField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...remaining } = current;
      return remaining;
    });
  };

  const toggleMixedComponent = (component: FeedingComponent) => {
    setMixedComponents((current) => (
      current.includes(component)
        ? current.filter((item) => item !== component)
        : [...current, component]
    ));
    clearFieldError('feedingType');
    if (component === 'formula') clearFieldError('milkAmountMl');
    if (component === 'bottle_breast') clearFieldError('breastMilkAmountMl');
    if (component === 'breast') {
      clearFieldError('leftDurationMin');
      clearFieldError('rightDurationMin');
    }
  };

  const selectFeedingType = (type: FeedingType) => {
    setFeedingType(type);
    clearFieldError('feedingType');
    if (type === 'formula') clearFieldError('milkAmountMl');
    if (type === 'bottle_breast') clearFieldError('breastMilkAmountMl');
    if (type === 'breast') {
      clearFieldError('leftDurationMin');
      clearFieldError('rightDurationMin');
    }
  };

  const handleSave = async () => {
    const selected = new Set(mixedComponents);
    const usesFormula = feedingType === 'formula' || (feedingType === 'mixed' && selected.has('formula'));
    const usesBottleBreast = feedingType === 'bottle_breast'
      || (feedingType === 'mixed' && selected.has('bottle_breast'));
    const usesBreast = feedingType === 'breast' || (feedingType === 'mixed' && selected.has('breast'));
    const nextFieldErrors: Partial<Record<FeedingValidationField, string>> = {};
    if (feedingType === 'mixed' && mixedComponents.length < 2) {
      nextFieldErrors.feedingType = '混合喂养至少选择两项';
    }
    if (usesFormula && milkAmount === '') nextFieldErrors.milkAmountMl = '请填写奶粉量';
    if (usesBottleBreast && breastMilkAmount === '') nextFieldErrors.breastMilkAmountMl = '请填写瓶喂母乳量';
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }

    const input: FeedingCreateInput = {
      eventTimeMs,
      feedingType,
      milkAmountMl: usesFormula ? toInputNumber(milkAmount) : null,
      breastMilkAmountMl: usesBottleBreast ? toInputNumber(breastMilkAmount) : null,
      leftDurationMin: usesBreast ? toInputNumber(leftDuration) : null,
      rightDurationMin: usesBreast ? toInputNumber(rightDuration) : null,
      note: note || null,
    };

    await submissionLock.current.run(async () => {
      setSaving(true);
      setErrorMessage(null);
      try {
        await onSave(input, clientRequestId);
      } catch (error) {
        if (error instanceof FeedingValidationError) {
          setFieldErrors((current) => ({ ...current, [error.field]: error.message }));
        } else {
          setErrorMessage(toSafeUiMessage(error, '保存失败，请检查填写内容后重试。'));
        }
      } finally {
        setSaving(false);
      }
    });
  };

  const selected = new Set(mixedComponents);
  const showsFormula = feedingType === 'formula' || (feedingType === 'mixed' && selected.has('formula'));
  const showsBottleBreast = feedingType === 'bottle_breast'
    || (feedingType === 'mixed' && selected.has('bottle_breast'));
  const showsBreast = feedingType === 'breast' || (feedingType === 'mixed' && selected.has('breast'));
  const mixedComponentsError = feedingType === 'mixed' && mixedComponents.length < 2
    ? '混合喂养至少选择两项'
    : fieldErrors.feedingType;

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
        <FormField label="喂养方式" error={feedingType === 'mixed' ? null : fieldErrors.feedingType}>
          <View style={styles.segment}>
            {typeOptions.map((option) => {
              const selected = feedingType === option.value;
              return (
                <ChoiceChip
                  key={option.value}
                  accessibilityLabel={option.accessibilityLabel}
                  label={option.label}
                  onPress={() => selectFeedingType(option.value)}
                  selected={selected}
                />
              );
            })}
          </View>
        </FormField>

        {feedingType === 'mixed' && (
          <FormField label="混合组成" error={mixedComponentsError}>
            <View style={styles.segment}>
              <ChoiceChip
                accessibilityLabel="混合包含亲喂母乳"
                label="亲喂母乳"
                onPress={() => toggleMixedComponent('breast')}
                selected={selected.has('breast')}
              />
              <ChoiceChip
                accessibilityLabel="混合包含瓶喂母乳"
                label="瓶喂母乳"
                onPress={() => toggleMixedComponent('bottle_breast')}
                selected={selected.has('bottle_breast')}
              />
              <ChoiceChip
                accessibilityLabel="混合包含奶粉"
                label="奶粉"
                onPress={() => toggleMixedComponent('formula')}
                selected={selected.has('formula')}
              />
            </View>
          </FormField>
        )}

        <FormField label="记录时间" error={fieldErrors.eventTimeMs}>
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
          {pickerMode && (
            <DateTimePicker
              value={new Date(eventTimeMs)}
              mode={pickerMode}
              display="default"
              is24Hour
              maximumDate={pickerMode === 'date' ? new Date() : undefined}
              onValueChange={handlePickerChange}
              onDismiss={() => setPickerMode(null)}
            />
          )}
        </FormField>

        {showsFormula && (
          <NumericField
            label="奶粉量"
            accessibilityLabel="奶粉量"
            value={milkAmount}
            suffix="ml"
            step={10}
            error={fieldErrors.milkAmountMl}
            onChange={(value) => {
              setMilkAmount(value);
              clearFieldError('milkAmountMl');
            }}
          />
        )}

        {showsBottleBreast && (
          <NumericField
            label="瓶喂母乳量"
            accessibilityLabel="瓶喂母乳量"
            value={breastMilkAmount}
            suffix="ml"
            step={10}
            error={fieldErrors.breastMilkAmountMl}
            onChange={(value) => {
              setBreastMilkAmount(value);
              clearFieldError('breastMilkAmountMl');
            }}
          />
        )}

        {showsBreast && (
          <View style={styles.durationGrid}>
            <NumericField
              label="左侧"
              accessibilityLabel="左侧时长"
              value={leftDuration}
              suffix="分钟"
              error={fieldErrors.leftDurationMin}
              onChange={(value) => {
                setLeftDuration(value);
                clearFieldError('leftDurationMin');
              }}
            />
            <NumericField
              label="右侧"
              accessibilityLabel="右侧时长"
              value={rightDuration}
              suffix="分钟"
              error={fieldErrors.rightDurationMin}
              onChange={(value) => {
                setRightDuration(value);
                clearFieldError('rightDurationMin');
              }}
            />
          </View>
        )}

        <FormField label="备注" optional error={fieldErrors.note}>
          <AppTextInput
            accessibilityLabel="备注"
            maxLength={200}
            multiline
            onChangeText={(value) => {
              setNote(value);
              clearFieldError('note');
            }}
            placeholder="选填"
            value={note}
          />
        </FormField>

        {errorMessage && (
          <ThemedText themeColor="danger" selectable>
            {errorMessage}
          </ThemedText>
        )}

        <AppButton
          accessibilityLabel="保存喝奶记录"
          label={submitLabel}
          loading={saving}
          onPress={() => { void handleSave(); }}
        />

        {onDelete && (
          <AppButton
            accessibilityLabel="删除喝奶记录"
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
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  timeRow: { flexDirection: 'row', gap: Spacing.sm },
  timeButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  clockButton: { flexBasis: 120, flexGrow: 0, flexShrink: 0, width: 120, alignItems: 'center' },
  clockText: { fontVariant: ['tabular-nums'] },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  numberInputWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  numberInput: {
    ...Typography.keyNumber,
    paddingRight: 64,
    textAlign: 'center',
  },
  numberSuffix: { position: 'absolute', right: Spacing.md, top: 16 },
  stepButton: {
    width: 54,
    height: 54,
    borderWidth: 1,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationGrid: { gap: Spacing.lg },
  pressed: { opacity: 0.7 },
});
