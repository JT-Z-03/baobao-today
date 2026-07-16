import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SectionCard({ children, elevated = false, style }: PropsWithChildren<{ elevated?: boolean; style?: StyleProp<ViewStyle> }>) {
  const theme = useTheme();
  return (
    <View style={[
      styles.card,
      { backgroundColor: elevated ? theme.surfaceElevated : theme.surface, borderColor: theme.border },
      elevated && { boxShadow: Shadows.card },
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.sm },
});
