import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { RecordDateTimeField } from '@/components/ui/record-date-time-field';
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
  headerSubtitle?: string;
  onSave(input: FeedingCreateInput, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

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
  const { width, fontScale } = useWindowDimensions();
  const stackedNumber = width < 360 || fontScale > 1.3;
  const adjust = (delta: number) => {
    const current = /^\d+$/.test(value) ? Number(value) : 0;
    onChange(Math.max(0, current + delta).toString());
  };
  const renderStep = (direction: 'decrease' | 'increase') => (
    <Pressable
      accessibilityLabel={`${accessibilityLabel}${direction === 'decrease' ? '减少' : '增加'}${step}`}
      accessibilityRole="button"
      onPress={() => adjust((direction === 'decrease' ? -1 : 1) * (step ?? 0))}
      style={({ pressed }) => [
        styles.stepButton,
        stackedNumber && styles.wideStepButton,
        { backgroundColor: theme.primaryContainer },
        pressed && styles.pressed,
      ]}>
      <AppIcon color={theme.primary} name={direction === 'decrease' ? 'remove' : 'add'} size={28} />
    </Pressable>
  );

  return (
    <FormField label={label} error={error}>
      <View style={styles.numberRow}>
        {step && !stackedNumber ? renderStep('decrease') : null}
        <View style={[styles.numberInputWrap, { backgroundColor: theme.primaryContainer }]}>
          <AppTextInput
            accessibilityLabel={accessibilityLabel}
            error={error}
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={(next) => {
              if (/^\d*$/.test(next)) onChange(next);
            }}
            // Android RN 0.86 can defer auto-selection until the first digit
            // lays out, causing the next digit to replace it in an empty field.
            selectTextOnFocus={Platform.OS !== 'android'}
            style={[styles.numberInput, { backgroundColor: theme.primaryContainer }]}
            value={value}
          />
          <ThemedText pointerEvents="none" themeColor="textSecondary">{suffix}</ThemedText>
        </View>
        {step && !stackedNumber ? renderStep('increase') : null}
      </View>
      {step && stackedNumber ? <View style={styles.numberRow}>{renderStep('decrease')}{renderStep('increase')}</View> : null}
      {step ? <ThemedText type="small" themeColor="textMuted" style={styles.stepHint}>每次增减 {step}ml</ThemedText> : null}
    </FormField>
  );
}

export function FeedingForm({
  initialInput,
  clientRequestId,
  submitLabel = '保存记录',
  headerSubtitle,
  onSave,
  onDelete,
}: Props) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackedChoices = width < 360 || fontScale > 1.3;
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
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    <FormScreen
      title="记录喝奶"
      subtitle={headerSubtitle}
      icon="feeding"
      footer={(
        <>
          {errorMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{errorMessage}</ThemedText> : null}
          <AppButton
            accessibilityLabel="保存喝奶记录"
            label={submitLabel}
            loading={saving}
            onPress={() => { void handleSave(); }}
          />
          {onDelete ? (
            <AppButton
              accessibilityLabel="删除喝奶记录"
              disabled={saving}
              label="删除记录"
              onPress={onDelete}
              variant="destructive-ghost"
            />
          ) : null}
        </>
      )}>
        <FormField label="喂养方式" error={feedingType === 'mixed' ? null : fieldErrors.feedingType}>
          <View style={styles.segment}>
            {typeOptions.map((option) => {
              const selected = feedingType === option.value;
              return (
                <ChoiceChip
                  key={option.value}
                  accessibilityLabel={option.accessibilityLabel}
                  label={option.label}
                  leading={(
                    <View style={styles.typeIcon} pointerEvents="none">
                      <AppIcon
                        color={selected ? theme.primary : option.value === 'mixed' ? theme.poop : option.value === 'breast' ? theme.other : theme.feeding}
                        name={option.value === 'breast' ? 'breastfeeding' : 'feeding'}
                        size={30}
                      />
                      {option.value === 'mixed' ? <AppIcon color={selected ? theme.primary : theme.poop} name="add" size={16} /> : null}
                    </View>
                  )}
                  onPress={() => selectFeedingType(option.value)}
                  selected={selected}
                  style={[styles.typeChoice, stackedChoices && styles.stackedChoice]}
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

        <RecordDateTimeField
          label="记录时间"
          error={fieldErrors.eventTimeMs}
          valueMs={eventTimeMs}
          maximumDate={new Date()}
          dateAccessibilityLabel="修改记录日期"
          timeAccessibilityLabel="修改记录时间"
          onChange={(value) => {
            setEventTimeMs(value);
            clearFieldError('eventTimeMs');
          }}
        />

        {showsFormula && (
          <NumericField
            label={feedingType === 'mixed' ? '奶粉量' : '奶量'}
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
            label={feedingType === 'mixed' ? '瓶喂母乳量' : '奶量'}
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
            placeholder="记下这次喝奶的小细节"
            error={fieldErrors.note}
            value={note}
          />
        </FormField>

    </FormScreen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  typeChoice: { flexBasis: '47%', flexGrow: 1, minHeight: 60 },
  stackedChoice: { flexBasis: '100%' },
  typeIcon: { flexDirection: 'row', alignItems: 'center' },
  numberRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm },
  numberInputWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  numberInput: {
    ...Typography.inputNumber,
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    paddingHorizontal: 0,
    borderWidth: 0,
    textAlign: 'center',
  },
  stepButton: {
    width: 54,
    minHeight: 64,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepHint: { textAlign: 'center' },
  wideStepButton: { flex: 1, minHeight: 48 },
  durationGrid: { gap: Spacing.lg },
  pressed: { opacity: 0.7 },
});
