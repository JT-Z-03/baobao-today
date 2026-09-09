import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { type RecordVisualType } from '@/components/ui/record-type-badge';
import { RecordIconTile } from '@/components/ui/record-icon-tile';
import { AppIcon } from '@/components/ui/app-icon';
import { Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TimelineConnector = 'single' | 'start' | 'middle' | 'end';
export function timelineConnector(index: number, count: number): TimelineConnector {
  return count <= 1 ? 'single' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
}

type TimelineRowProps = {
  connector?: TimelineConnector;
  type: RecordVisualType;
  time: string;
  title: string;
  detail?: string | null;
  note?: string | null;
  hasNote?: boolean;
  hasPhoto?: boolean;
  accessibilityLabel: string;
  onPress(): void;
};

export function TimelineRow({ type, time, title, detail, note, hasNote = false, hasPhoto = false, accessibilityLabel, onPress, connector = 'single' }: TimelineRowProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const stackedTime = fontScale > 1.3;
  return (
    <Pressable
      accessibilityHint="打开记录详情并编辑"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        pressed && { backgroundColor: theme.surfaceElevated },
      ]}>
      {!stackedTime ? <View style={styles.timeColumn}>
        <ThemedText style={styles.time} selectable>{time}</ThemedText>
      </View> : null}
      <View style={styles.rail} pointerEvents="none">
        {connector === 'middle' || connector === 'end' ? <View style={[styles.lineTop, { borderColor: theme.border }]} /> : null}
        {connector === 'start' || connector === 'middle' ? <View style={[styles.lineBottom, { borderColor: theme.border }]} /> : null}
        <RecordIconTile type={type} />
      </View>
      <View style={styles.content}>
        {stackedTime ? <ThemedText style={styles.time} selectable>{time}</ThemedText> : null}
        <ThemedText style={styles.title}>{title}</ThemedText>
        {detail ? <ThemedText themeColor="textSecondary" selectable>{detail}</ThemedText> : null}
        {note ? <ThemedText numberOfLines={2} themeColor="textSecondary" type="small" selectable>{note}</ThemedText> : null}
        {(hasNote || hasPhoto) ? (
          <View style={styles.indicators}>
            {hasNote ? <ThemedText accessibilityLabel="有备注" themeColor="textMuted" type="small">备注</ThemedText> : null}
            {hasPhoto ? <ThemedText accessibilityLabel="有照片" themeColor="textMuted" type="small">照片</ThemedText> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.chevron}><AppIcon name="next" size={18} color={theme.textMuted} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 68, flexDirection: 'row', gap: Spacing.md },
  timeColumn: { width: 56, paddingTop: Spacing.sm },
  time: { ...Typography.bodyStrong, fontVariant: ['tabular-nums'] },
  rail: { width: 40, alignItems: 'center' },
  lineTop: { position: 'absolute', top: 0, height: 20, borderLeftWidth: 1, borderStyle: 'dashed' },
  lineBottom: { position: 'absolute', top: 40, bottom: 0, borderLeftWidth: 1, borderStyle: 'dashed' },
  content: { flex: 1, minWidth: 0, gap: Spacing.xs, paddingBottom: Spacing.xl, paddingTop: Spacing.xs },
  title: { ...Typography.bodyStrong },
  chevron: { paddingTop: Spacing.sm },
  indicators: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
});
