import { useDraftField } from '@/features/records/hooks/use-record-draft';
import { type ReactNode, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { RecordDateTimeField, RecordDateHint } from '@/components/ui/record-date-time-field';
import { Spacing } from '@/constants/theme';
import type { PeeAmount, PeeColor, PeeCoreInput } from '@/domain/pee/pee';
import { PEE_AMOUNT_LABELS, PEE_COLOR_LABELS } from '@/features/pee/pee-format';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  initialInput: PeeCoreInput;
  clientRequestId: string | null;
  headerSubtitle?: string;
  submitLabel?: string;
  onSave(input: PeeCoreInput, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

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

type ChoiceGroupProps<T extends string> = {
  title: string;
  accessibilityPrefix: string;
  value: T | null;
  options: readonly [T, string][];
  onChange(value: T | null): void;
  leading?: (value: T) => ReactNode;
  choiceStyle?: StyleProp<ViewStyle>;
};

function ChoiceGroup<T extends string>({
  title, accessibilityPrefix, value, options, onChange, leading, choiceStyle,
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
              leading={leading?.(option)}
              onPress={() => onChange(selected ? null : option)}
              selected={selected}
              style={choiceStyle}
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
  headerSubtitle,
  submitLabel = '保存记录',
  onSave,
  onDelete,
}: Props) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const colorSwatches: Record<PeeColor, string> = {
    clear: theme.surface,
    light_yellow: theme.urinePale,
    yellow: theme.urineYellow,
    dark_yellow: theme.urineDark,
  };
  const submissionLock = useRef(createPeeSubmissionLock());
  const [eventTimeMs, setEventTimeMs] = useDraftField('eventTimeMs', initialInput.eventTimeMs);
  const [amount, setAmount] = useDraftField('amount', initialInput.amount);
  const [color, setColor] = useDraftField('color', initialInput.color);
  const [note, setNote] = useDraftField('note', initialInput.note ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    <FormScreen
      compact
      title="记录小便"
      subtitle={headerSubtitle}
      icon="pee"
      footer={(
        <>
          <RecordDateHint valueMs={eventTimeMs} />
          {errorMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{errorMessage}</ThemedText> : null}
          <AppButton accessibilityLabel="保存小便记录" label={submitLabel} loading={saving} onPress={() => { void handleSave(); }} />
          {onDelete ? <AppButton accessibilityLabel="删除小便记录" disabled={saving} label="删除记录" onPress={onDelete} variant="destructive-ghost" /> : null}
        </>
      )}>
        <View style={styles.timeSection}>
          <RecordDateTimeField
            label="发生时间"
            valueMs={eventTimeMs}
            onChange={setEventTimeMs}
            maximumDate={new Date()}
            dateAccessibilityLabel="修改记录日期"
            timeAccessibilityLabel="修改记录时间"
          />
          <ThemedText themeColor="textSecondary" type="small">只记时间，也可以保存</ThemedText>
        </View>

        <ChoiceGroup<PeeAmount>
          title="尿量"
          accessibilityPrefix="选择尿量"
          value={amount}
          options={amountOptions}
          onChange={setAmount}
          choiceStyle={[styles.amountChoice, fontScale > 1.3 && styles.wideAmountChoice]}
        />
        <ChoiceGroup<PeeColor>
          title="颜色"
          accessibilityPrefix="选择尿液颜色"
          value={color}
          options={colorOptions}
          onChange={setColor}
          choiceStyle={styles.colorChoice}
          leading={(option) => (
            <View accessible={false} style={[styles.swatch, { backgroundColor: colorSwatches[option], borderColor: theme.border }, option === 'clear' && styles.clearSwatch]} />
          )}
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

    </FormScreen>
  );
}

const styles = StyleSheet.create({
  timeSection: { gap: Spacing.sm },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  amountChoice: { flexBasis: '30%', flexGrow: 1, minWidth: 80 },
  wideAmountChoice: { minWidth: 112 },
  colorChoice: { flexBasis: '45%', flexGrow: 1, minWidth: 120 },
  swatch: { width: 26, height: 26, borderRadius: 13, flexShrink: 0 },
  clearSwatch: { borderWidth: 1 },
});
