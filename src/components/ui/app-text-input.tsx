import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AppTextInputProps = TextInputProps & { error?: string | null; maxCodePointLength?: number };
type SelectionSnapshot = { text: string; start: number; end: number };

function limitCodePointEdit(text: string, previous: string, limit: number, selection: SelectionSnapshot | null) {
  const next = [...text];
  if (next.length <= limit) return text;
  if (!previous) return next.slice(0, limit).join('');
  if (!selection || selection.text !== previous) return previous;
  const { start, end } = selection;
  // Native selection offsets are UTF-16; never split a supplementary code point.
  const splitsCodePoint = (index: number) => index > 0 && (previous.codePointAt(index - 1) ?? 0) > 0xffff;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start
    || end > previous.length || splitsCodePoint(start) || splitsCodePoint(end)) return previous;
  const prefix = previous.slice(0, start);
  const suffix = previous.slice(end);
  // An IME or stale event may edit outside the recorded selection: reject overflow safely.
  if (text.length < prefix.length + suffix.length || !text.startsWith(prefix) || !text.endsWith(suffix)) return previous;
  const available = limit - [...prefix].length - [...suffix].length;
  if (available < 0) return previous;
  const inserted = text.slice(prefix.length, text.length - suffix.length);
  return prefix + [...inserted].slice(0, available).join('') + suffix;
}

export function AppTextInput({ error, maxCodePointLength, maxLength, multiline, onBlur, onChangeText, onFocus, onSelectionChange, style, ...props }: AppTextInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const selection = useRef<SelectionSnapshot | null>(null);
  const previous = props.value ?? props.defaultValue ?? '';
  useEffect(() => { selection.current = null; }, [previous]);
  const borderColor = error ? theme.danger : focused ? theme.inputFocused : theme.border;
  return (
    <TextInput
      {...props}
      // Native maxLength counts UTF-16 units; a valid code point needs at most two.
      maxLength={maxCodePointLength === undefined ? maxLength : maxCodePointLength * 2}
      onChangeText={(text) => {
        const snapshot = selection.current;
        selection.current = null;
        onChangeText?.(maxCodePointLength === undefined ? text : limitCodePointEdit(text, previous, maxCodePointLength, snapshot));
      }}
      onSelectionChange={maxCodePointLength === undefined ? onSelectionChange : (event) => {
        selection.current = { text: previous, ...event.nativeEvent.selection };
        onSelectionChange?.(event);
      }}
      accessibilityHint={error ?? props.accessibilityHint}
      maxFontSizeMultiplier={props.maxFontSizeMultiplier ?? 1.6}
      multiline={multiline}
      onBlur={(event) => { selection.current = null; setFocused(false); onBlur?.(event); }}
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
