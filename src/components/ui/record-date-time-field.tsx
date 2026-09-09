import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppIcon } from '@/components/ui/app-icon';
import { FormField } from '@/components/ui/form-field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string; valueMs: number; onChange(valueMs: number): void; disabled?: boolean;
  error?: string | null; maximumDate?: Date;
  dateAccessibilityLabel: string; timeAccessibilityLabel: string;
};

export function mergeDateTimePart(currentMs: number, selected: Date, part: 'date' | 'time') {
  const current = new Date(currentMs);
  return part === 'date'
    ? new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds()).getTime()
    : new Date(current.getFullYear(), current.getMonth(), current.getDate(), selected.getHours(), selected.getMinutes(), 0, 0).getTime();
}

export function RecordDateTimeField({ label, valueMs, onChange, disabled = false, error, maximumDate, dateAccessibilityLabel, timeAccessibilityLabel }: Props) {
  const theme = useTheme();
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
        <Pressable accessibilityRole="button" accessibilityLabel={dateAccessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setPickerMode('date')} style={styles.date}>
          <AppIcon name="calendar" size={22} color={theme.primary} />
          <ThemedText style={styles.text}>{date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日</ThemedText>
          <AppIcon name="next" size={16} color={theme.textMuted} />
        </Pressable>
        <View style={[stacked ? styles.horizontalDivider : styles.divider, { backgroundColor: theme.divider }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={timeAccessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setPickerMode('time')} style={styles.time}>
          <AppIcon name="clock" size={22} color={theme.primary} />
          <ThemedText style={styles.text}>{date.getHours().toString().padStart(2, '0')}:{date.getMinutes().toString().padStart(2, '0')}</ThemedText>
          <AppIcon name="next" size={16} color={theme.textMuted} />
        </Pressable>
      </View>
      {pickerMode ? <DateTimePicker value={date} mode={pickerMode} display="default" is24Hour maximumDate={pickerMode === 'date' ? maximumDate : undefined} onValueChange={change} onDismiss={() => setPickerMode(null)} /> : null}
    </FormField>
  );
}
const styles = StyleSheet.create({
  field: { borderWidth: 1, borderRadius: Radius.control, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: Spacing.sm },
  stacked: { flexDirection: 'column' },
  date: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 54, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.xs },
  time: { minHeight: 54, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.xs },
  text: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  divider: { width: 1, marginVertical: Spacing.sm, marginHorizontal: Spacing.sm },
  horizontalDivider: { height: 1 },
});
