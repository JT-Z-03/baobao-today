import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AppTextInputProps = TextInputProps & { error?: string | null };

export function AppTextInput({ error, multiline, onBlur, onFocus, style, ...props }: AppTextInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.danger : focused ? theme.inputFocused : theme.border;
  return (
    <TextInput
      {...props}
      accessibilityHint={error ?? props.accessibilityHint}
      maxFontSizeMultiplier={props.maxFontSizeMultiplier ?? 1.6}
      multiline={multiline}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      placeholderTextColor={theme.textMuted}
      selectionColor={theme.primary}
      style={[
        styles.input,
        multiline && styles.multiline,
        { backgroundColor: theme.inputBackground, borderColor, color: theme.textPrimary },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: { ...Typography.body, minHeight: 52, borderWidth: 1, borderRadius: Radius.control, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
