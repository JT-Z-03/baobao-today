import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type BaseStateProps = { message: string; detail?: string };

function StateCopy({ message, detail }: BaseStateProps) {
  return (
    <>
      <ThemedText type="smallBold" selectable>{message}</ThemedText>
      {detail ? <ThemedText type="small" themeColor="textSecondary" selectable>{detail}</ThemedText> : null}
    </>
  );
}

export function EmptyState(props: BaseStateProps) {
  return <View accessibilityRole="summary" style={styles.state}><StateCopy {...props} /></View>;
}

export function LoadingState(props: BaseStateProps) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={styles.state} testID="loading-state">
      <ActivityIndicator color={theme.primary} />
      <StateCopy {...props} />
    </View>
  );
}

export function ErrorState({ actionLabel, onAction, ...props }: BaseStateProps & { actionLabel?: string; onAction?(): void }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.state}>
      <ThemedText type="smallBold" themeColor="danger" selectable>{props.message}</ThemedText>
      {props.detail ? <ThemedText type="small" themeColor="textSecondary" selectable>{props.detail}</ThemedText> : null}
      {actionLabel && onAction ? <AppButton compact label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { minHeight: 88, justifyContent: 'center', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.md },
});
