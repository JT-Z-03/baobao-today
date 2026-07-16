import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type FormFieldProps = PropsWithChildren<{
  label: string;
  optional?: boolean;
  error?: string | null;
  hint?: string;
}>;

export function FormField({ label, optional = false, error, hint, children }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {optional ? <ThemedText themeColor="textMuted" type="small">选填</ThemedText> : null}
      </View>
      {children}
      {hint && !error ? <ThemedText themeColor="textMuted" type="small" selectable>{hint}</ThemedText> : null}
      {error ? (
        <ThemedText accessibilityLiveRegion="polite" themeColor="danger" type="small" selectable>{error}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.md },
});
