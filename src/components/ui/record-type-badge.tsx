import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type RecordVisualType = 'feeding' | 'poop' | 'pee' | 'sleep' | 'other';

const tokenMap: Record<RecordVisualType, { color: ThemeColor; container: ThemeColor }> = {
  feeding: { color: 'feeding', container: 'feedingContainer' },
  poop: { color: 'poop', container: 'poopContainer' },
  pee: { color: 'pee', container: 'peeContainer' },
  sleep: { color: 'sleep', container: 'sleepContainer' },
  other: { color: 'other', container: 'otherContainer' },
};

export function RecordTypeBadge({ type, label }: { type: RecordVisualType; label: string }) {
  const theme = useTheme();
  const tokens = tokenMap[type];
  return (
    <View style={[styles.badge, { backgroundColor: theme[tokens.container] }]}>
      <AppIcon color={theme[tokens.color]} name={type} size={18} />
      <ThemedText themeColor={tokens.color} type="smallBold" style={styles.label}>{label}</ThemedText>
    </View>
  );
}

export function getRecordTypeTokens(type: RecordVisualType) {
  return tokenMap[type];
}

const styles = StyleSheet.create({
  badge: { minHeight: 32, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.control, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  label: { flexShrink: 1 },
});
