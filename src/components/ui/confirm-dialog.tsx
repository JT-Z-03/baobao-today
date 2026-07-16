import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
  variant?: 'default' | 'destructive';
  busy?: boolean;
  error?: string | null;
  cancelLabel?: string | null;
};

export function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel, variant = 'default', busy = false, error, cancelLabel = '取消' }: ConfirmDialogProps) {
  const theme = useTheme();
  return (
    <Modal animationType="fade" onRequestClose={onCancel} statusBarTranslucent transparent visible={visible}>
      <View accessibilityViewIsModal style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <View style={styles.copy}>
            <ThemedText style={styles.title} selectable>{title}</ThemedText>
            <ThemedText themeColor="textSecondary" selectable>{message}</ThemedText>
            {error ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" type="small" selectable>{error}</ThemedText> : null}
          </View>
          <View style={styles.actions}>
            {cancelLabel ? <AppButton disabled={busy} label={cancelLabel} onPress={onCancel} variant="secondary" style={styles.action} /> : null}
            <AppButton loading={busy} label={confirmLabel} onPress={onConfirm} variant={variant === 'destructive' ? 'destructive' : 'primary'} style={styles.action} />
          </View>
        </View>
        <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  dialog: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: Radius.card, padding: Spacing.xl, gap: Spacing.xl, zIndex: 1 },
  copy: { gap: Spacing.sm },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, minWidth: 0 },
});
