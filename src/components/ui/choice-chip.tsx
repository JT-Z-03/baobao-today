import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChoiceChipProps = {
  label: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
  accessibilityLabel?: string;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ChoiceChip({ label, selected, onPress, disabled = false, accessibilityLabel, leading, style }: ChoiceChipProps) {
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
        style,
      ]}>
      <View style={styles.content}>
        {leading ? <View pointerEvents="none" accessible={false}>{leading}</View> : null}
        <ThemedText themeColor={selected ? 'primaryOnContainer' : 'textPrimary'} style={styles.label}>{label}</ThemedText>
        {selected ? <ThemedText testID="choice-chip-check" themeColor="primaryOnContainer" type="smallBold">✓</ThemedText> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 48, borderWidth: 1, borderRadius: Radius.control, justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  label: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
