import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { ExportCsvResult } from '@/application/export/export-csv-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ScreenContainer } from '@/components/ui/screen-container';
import { SectionCard } from '@/components/ui/section-card';
import { Spacing, Typography } from '@/constants/theme';
import { parseLocalDateKey, toLocalDateKey } from '@/domain/date/local-date';
import type { ExportScope } from '@/domain/export/export-range';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type RangeKind = 'all' | 'date-range';
type DateField = 'start' | 'end';

export function CsvExportScreen() {
  const theme = useTheme();
  const { exportCsvService } = useAppState();
  const [today] = useState(() => toLocalDateKey(Date.now()));
  const [rangeKind, setRangeKind] = useState<RangeKind>('all');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [dateField, setDateField] = useState<DateField | null>(null);
  const [busy, setBusy] = useState(false);
  const [emptyConfirmationVisible, setEmptyConfirmationVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!exportCsvService) return null;

  const scope: ExportScope = rangeKind === 'all'
    ? { kind: 'all' }
    : { kind: 'date-range', startDate, endDate };

  const showResult = (result: ExportCsvResult) => {
    if (result.kind === 'share-unavailable') {
      setErrorMessage('当前设备无法打开系统分享面板，CSV文件已生成，请稍后重试。');
      return;
    }
    if (result.kind === 'share-sheet-closed') setMessage('分享面板已关闭。App不会自动上传导出文件。');
  };

  const runExport = async (allowEmpty = false) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      const result = allowEmpty
        ? await exportCsvService.exportCsv(scope, { allowEmpty: true })
        : await exportCsvService.exportCsv(scope);
      if (result.kind === 'empty-confirmation-required') {
        setEmptyConfirmationVisible(true);
        return;
      }
      showResult(result);
    } catch (error) {
      setErrorMessage(toSafeUiMessage(error, '导出失败，请检查日期范围后重试。'));
    } finally {
      setBusy(false);
    }
  };

  const onDateChange = (_event: DateTimePickerChangeEvent, value: Date) => {
    const dateKey = toLocalDateKey(value.getTime());
    if (dateField === 'start') setStartDate(dateKey);
    if (dateField === 'end') setEndDate(dateKey);
    setDateField(null);
  };

  return (
    <>
      <ScreenContainer contentStyle={styles.content}>
        <View style={styles.heading}>
          <ThemedText style={styles.title} selectable>导出表格</ThemedText>
          <AppIcon name="export" color={theme.pee} size={32} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          CSV适合查看和分享，不包含大便照片，也不能用于完整恢复App数据。
        </ThemedText>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle} selectable>导出范围</ThemedText>
          <View style={styles.rangeOptions}>
            <ChoiceChip accessibilityLabel="选择全部记录" disabled={busy} label="全部记录" onPress={() => setRangeKind('all')} selected={rangeKind === 'all'} />
            <ChoiceChip accessibilityLabel="选择自定义日期范围" disabled={busy} label="自定义日期" onPress={() => setRangeKind('date-range')} selected={rangeKind === 'date-range'} />
          </View>
        </View>

        {rangeKind === 'date-range' ? (
          <SectionCard>
            <Pressable accessibilityLabel="选择导出开始日期" accessibilityRole="button" disabled={busy} onPress={() => setDateField('start')} style={styles.dateRow}>
              <ThemedText themeColor="textSecondary">开始日期</ThemedText>
              <ThemedText style={styles.dateValue} selectable>{startDate}</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <Pressable accessibilityLabel="选择导出结束日期" accessibilityRole="button" disabled={busy} onPress={() => setDateField('end')} style={styles.dateRow}>
              <ThemedText themeColor="textSecondary">结束日期</ThemedText>
              <ThemedText style={styles.dateValue} selectable>{endDate}</ThemedText>
            </Pressable>
          </SectionCard>
        ) : null}

        {dateField ? (
          <DateTimePicker
            value={parseLocalDateKey(dateField === 'start' ? startDate : endDate)}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onValueChange={onDateChange}
            onDismiss={() => setDateField(null)}
          />
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" selectable>跨天睡眠只要与所选日期范围有重叠，就会包含在导出文件中。</ThemedText>
        {message ? <ThemedText accessibilityLiveRegion="polite" selectable>{message}</ThemedText> : null}
        {errorMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{errorMessage}</ThemedText> : null}
        <AppButton accessibilityLabel="开始导出CSV" label="导出表格" loading={busy} onPress={() => { void runExport(); }} />
      </ScreenContainer>
      <ConfirmDialog
        visible={emptyConfirmationVisible}
        title="所选范围内没有记录"
        message="所选范围内没有记录，将导出一份只有表头的空表。"
        confirmLabel="继续导出"
        onCancel={() => setEmptyConfirmationVisible(false)}
        onConfirm={() => {
          setEmptyConfirmationVisible(false);
          void runExport(true);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { maxWidth: 560, gap: Spacing.xxl },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  title: { ...Typography.pageTitle, flex: 1 },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.sectionTitle },
  rangeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dateRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  dateValue: { flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth },
});
