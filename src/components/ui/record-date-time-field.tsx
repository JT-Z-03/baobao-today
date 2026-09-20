import { useLocalClock } from '@/hooks/use-local-clock';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppIcon } from '@/components/ui/app-icon';
import { FormField } from '@/components/ui/form-field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRecordTime, recordTimeShortcut } from '@/domain/date/record-time-shortcuts';
import { toLocalDateKey } from '@/domain/date/local-date';
import { ChoiceChip } from '@/components/ui/choice-chip';

type Props = {
  label: string; valueMs: number; onChange(valueMs: number): void; disabled?: boolean;
  error?: string | null; maximumDate?: Date; shortcuts?: boolean; onActivate?(): void;
  dateAccessibilityLabel: string; timeAccessibilityLabel: string;
};

export function mergeDateTimePart(currentMs: number, selected: Date, part: 'date' | 'time') {
  const current = new Date(currentMs);
  return part === 'date'
    ? new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds()).getTime()
    : new Date(current.getFullYear(), current.getMonth(), current.getDate(), selected.getHours(), selected.getMinutes(), 0, 0).getTime();
}

export function RecordDateTimeField({ label, valueMs, onChange, disabled = false, error, maximumDate, shortcuts = true, onActivate, dateAccessibilityLabel, timeAccessibilityLabel }: Props) {
  const theme = useTheme();
  const nowMs = useLocalClock();
  const { width, fontScale } = useWindowDimensions();
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const date = new Date(valueMs);
  const stacked = width < 360 || fontScale > 1.3;
  const change = (_event: DateTimePickerChangeEvent, selected: Date) => {
    if (pickerMode && selected) onChange(mergeDateTimePart(valueMs, selected, pickerMode));
    setPickerMode(null);
  };
  return (
    <FormField label={label} error={error}>
      <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }, stacked && styles.stacked]}>
        <Pressable accessibilityRole="button" accessibilityLabel={dateAccessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { onActivate?.(); setPickerMode('date'); }} style={styles.date}>
          <AppIcon name="calendar" size={22} color={theme.primary} />
          <ThemedText style={styles.text}>{date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日</ThemedText>
          <AppIcon name="next" size={16} color={theme.textMuted} />
        </Pressable>
        <View style={[stacked ? styles.horizontalDivider : styles.divider, { backgroundColor: theme.divider }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={timeAccessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { onActivate?.(); setPickerMode('time'); }} style={styles.time}>
          <AppIcon name="clock" size={22} color={theme.primary} />
          <ThemedText style={styles.text}>{date.getHours().toString().padStart(2, '0')}:{date.getMinutes().toString().padStart(2, '0')}</ThemedText>
          <AppIcon name="next" size={16} color={theme.textMuted} />
        </Pressable>
      </View>
      {shortcuts ? <View style={styles.shortcuts}>
        {([0, 10, 30] as const).map((minutes) => <ChoiceChip key={minutes}
          label={minutes === 0 ? '现在' : `${minutes} 分钟前`}
          accessibilityLabel={`${label}：${minutes === 0 ? '现在' : `${minutes}分钟前`}`}
          selected={false} disabled={disabled}
          onPress={() => onChange(recordTimeShortcut(Date.now(), minutes))} />)}
      </View> : onActivate ? <Pressable accessibilityRole="button" onPress={onActivate}><ThemedText type="small">快速选择{label}</ThemedText></Pressable> : null}
      {toLocalDateKey(valueMs) !== toLocalDateKey(nowMs)
        ? <ThemedText type="small" themeColor="textSecondary">将记录到{formatRecordTime(valueMs, nowMs)}</ThemedText> : null}
      {pickerMode ? <DateTimePicker value={date} mode={pickerMode} display="default" is24Hour maximumDate={pickerMode === 'date' ? maximumDate : undefined} onValueChange={change} onDismiss={() => setPickerMode(null)} /> : null}
    </FormField>
  );
}
const styles = StyleSheet.create({
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  field: { borderWidth: 1, borderRadius: Radius.control, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: Spacing.sm },
  stacked: { flexDirection: 'column' },
  date: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 54, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.xs },
  time: { minHeight: 54, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.xs },
  text: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  divider: { width: 1, marginVertical: Spacing.sm, marginHorizontal: Spacing.sm },
  horizontalDivider: { height: 1 },
});

export function RecordDateHint({ valueMs }: { valueMs: number }) {
  const nowMs = useLocalClock();
  return toLocalDateKey(valueMs) !== toLocalDateKey(nowMs)
    ? <ThemedText type="small" themeColor="textSecondary">将记录到{formatRecordTime(valueMs, nowMs)}</ThemedText> : null;
}
