import { ActivityIndicator, Pressable, StyleSheet, View, type AccessibilityState, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AppButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

type AppButtonProps = {
  label: string;
  onPress(): void;
  variant?: AppButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  compact?: boolean;
  style?: ViewStyle;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityState,
  compact = false,
  style,
}: AppButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const colors = variant === 'primary'
    ? { backgroundColor: theme.primary, borderColor: theme.primary, text: 'primaryText' as const }
    : variant === 'destructive'
      ? { backgroundColor: theme.danger, borderColor: theme.danger, text: 'dangerText' as const }
      : variant === 'secondary'
        ? { backgroundColor: theme.surfaceElevated, borderColor: theme.border, text: 'textPrimary' as const }
        : { backgroundColor: 'transparent', borderColor: 'transparent', text: 'primary' as const };

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, busy: loading, disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: colors.backgroundColor, borderColor: colors.borderColor },
        pressed && !inactive && { backgroundColor: variant === 'primary' ? theme.primaryPressed : colors.backgroundColor, opacity: 0.82 },
        inactive && styles.disabled,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={theme[colors.text]} size="small" testID="app-button-spinner" /> : null}
        <ThemedText type="smallBold" themeColor={colors.text} style={styles.label}>{label}</ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: Radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  compact: { minHeight: 48, alignSelf: 'flex-start' },
  content: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  label: { textAlign: 'center', flexShrink: 1 },
  disabled: { opacity: 0.48 },
});
