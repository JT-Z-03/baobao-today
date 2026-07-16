import { StyleSheet, View } from 'react-native';

import type { RestoreSummary as RestoreSummaryData } from '@/application/backup/backup-validation-service';
import { ThemedText } from '@/components/themed-text';
import { SectionCard } from '@/components/ui/section-card';
import { Spacing } from '@/constants/theme';

function formatDateTime(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function RestoreSummary({ summary }: { summary: RestoreSummaryData }) {
  return (
    <SectionCard>
      <ThemedText type="smallBold" selectable>恢复预览</ThemedText>
      <View style={styles.row}><ThemedText themeColor="textSecondary">宝宝</ThemedText><ThemedText style={styles.value} selectable>{summary.babyName}</ThemedText></View>
      <View style={styles.row}><ThemedText themeColor="textSecondary">出生日期</ThemedText><ThemedText style={styles.value} selectable>{summary.babyBirthDate}</ThemedText></View>
      <View style={styles.row}><ThemedText themeColor="textSecondary">备份时间</ThemedText><ThemedText style={styles.value} selectable>{formatDateTime(summary.backupCreatedAtMs)}</ThemedText></View>
      <ThemedText type="small" selectable>喝奶 {summary.feedingCount} · 大便 {summary.poopCount} · 小便 {summary.peeCount}</ThemedText>
      <ThemedText type="small" selectable>睡眠 {summary.sleepCount} · 其他 {summary.otherCount} · 照片 {summary.photoCount}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" selectable>
        {summary.hasActiveSleep ? '包含一条进行中睡眠' : '不包含进行中睡眠'} · App {summary.appVersion}
      </ThemedText>
      <ThemedText type="small" themeColor="danger" selectable>
        恢复后，当前手机中的宝宝资料、记录和照片将被替换，不会合并数据。
      </ThemedText>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, flexWrap: 'wrap' },
  value: { flexShrink: 1, textAlign: 'right' },
});
