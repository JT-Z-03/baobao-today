import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenContainerProps = PropsWithChildren<{
  contentStyle?: ScrollViewProps['contentContainerStyle'];
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
}>;

export function ScreenContainer({ children, contentStyle, keyboardShouldPersistTaps = 'handled' }: ScreenContainerProps) {
  const theme = useTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, contentStyle]}>
      {children}
    </ScrollView>
  );
}

export function nativeTabSafeAreaEdges(os = process.env.EXPO_OS): Edge[] {
  return os === 'android' ? ['top', 'left', 'right'] : ['left', 'right'];
}

export function NativeTabScreenContainer(props: ScreenContainerProps) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={nativeTabSafeAreaEdges()}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScreenContainer {...props} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 120, gap: Spacing.xl },
});
