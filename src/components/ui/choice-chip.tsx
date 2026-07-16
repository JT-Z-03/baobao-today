import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChoiceChipProps = {
  label: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function ChoiceChip({ label, selected, onPress, disabled = false, accessibilityLabel }: ChoiceChipProps) {
  const theme = useTheme();
  const spokenLabel = accessibilityLabel ?? `${label}${selected ? '，已选择' : ''}`;
  return (
    <Pressable
      accessibilityLabel={spokenLabel}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: selected ? theme.primaryContainer : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <View style={styles.content}>
        {selected ? <ThemedText testID="choice-chip-check" themeColor="primary" type="smallBold">✓</ThemedText> : null}
        <ThemedText themeColor={selected ? 'primary' : 'textPrimary'} type="smallBold" style={styles.label}>{label}</ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 48, borderWidth: 1, borderRadius: Radius.card, justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  label: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
