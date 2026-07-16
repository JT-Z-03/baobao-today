import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { RecordTypeBadge, getRecordTypeTokens, type RecordVisualType } from '@/components/ui/record-type-badge';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TimelineRowProps = {
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

export function TimelineRow({ type, time, title, detail, note, hasNote = false, hasPhoto = false, accessibilityLabel, onPress }: TimelineRowProps) {
  const theme = useTheme();
  const tokens = getRecordTypeTokens(type);
  return (
    <Pressable
      accessibilityHint="打开记录详情并编辑"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme[tokens.color] },
        pressed && { backgroundColor: theme.surfaceElevated },
      ]}>
      <View style={styles.timeColumn}>
        <ThemedText style={styles.time} selectable>{time}</ThemedText>
      </View>
      <View style={styles.content}>
        <RecordTypeBadge label={title} type={type} />
        {detail ? <ThemedText selectable>{detail}</ThemedText> : null}
        {note ? <ThemedText numberOfLines={2} themeColor="textSecondary" type="small" selectable>{note}</ThemedText> : null}
        {(hasNote || hasPhoto) ? (
          <View style={styles.indicators}>
            {hasNote ? <ThemedText accessibilityLabel="有备注" themeColor="textMuted" type="small">备注</ThemedText> : null}
            {hasPhoto ? <ThemedText accessibilityLabel="有照片" themeColor="textMuted" type="small">照片</ThemedText> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 84, flexDirection: 'row', borderWidth: 1, borderLeftWidth: 3, borderRadius: Radius.card, padding: Spacing.md, gap: Spacing.md },
  timeColumn: { width: 56, paddingTop: Spacing.xs },
  time: { ...Typography.label, fontVariant: ['tabular-nums'] },
  content: { flex: 1, minWidth: 0, gap: Spacing.sm },
  indicators: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
});
