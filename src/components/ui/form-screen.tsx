import { use, type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { keyboardAvoidingBehavior, useFormKeyboardVerticalOffset } from '@/components/ui/keyboard-behavior';
import { RecordIconTile } from '@/components/ui/record-icon-tile';
import type { RecordVisualType } from '@/components/ui/record-type-badge';
import { Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = PropsWithChildren<{ title: string; subtitle?: string; icon?: RecordVisualType; footer: ReactNode; compact?: boolean }>;

export function FormScreen({ title, subtitle, icon, children, footer, compact = false }: Props) {
  const theme = useTheme();
  const offset = useFormKeyboardVerticalOffset();
  const insets = use(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.background }]} behavior={keyboardAvoidingBehavior()} keyboardVerticalOffset={offset}>
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.scroll, { paddingBottom: Spacing.xxl + (process.env.EXPO_OS === 'android' ? insets?.bottom ?? 0 : 0) }]}>
        <View style={styles.inner}>
          <View style={[styles.header, compact && styles.compactHeader]}>
            <View style={styles.heading}>
              <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
              {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
            </View>
            {icon ? <RecordIconTile type={icon} size={48} /> : null}
          </View>
          <View style={[styles.fields, compact && styles.compactFields]}>{children}</View>
          <View style={[styles.footer, compact && styles.compactFooter]}>{footer}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  inner: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xxl },
  heading: { flex: 1, minWidth: 0, gap: Spacing.xs },
  title: { ...Typography.pageTitle },
  fields: { gap: Spacing.xl },
  footer: { marginTop: 'auto', paddingTop: Spacing.xxl, gap: Spacing.md },
  compactHeader: { marginBottom: Spacing.lg },
  compactFields: { gap: Spacing.md },
  compactFooter: { paddingTop: Spacing.lg },
});
