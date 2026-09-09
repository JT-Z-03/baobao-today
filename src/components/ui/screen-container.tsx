import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScreenContainerProps = PropsWithChildren<{
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

export function NativeTabScreenContainer({ footer, children, ...props }: ScreenContainerProps & { footer?: ReactNode }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  // iOS Native Tabs applies its automatic bottom inset to the first ScrollView only.
  const fixedFooter = Boolean(process.env.EXPO_OS !== 'ios' && footer && footerHeight && height - footerHeight >= 240 && fontScale <= 1.3);
  const renderedFooter = footer ? (
    <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)} style={styles.footer}>
      {footer}
    </View>
  ) : null;
  return (
    <SafeAreaView
      edges={nativeTabSafeAreaEdges()}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScreenContainer {...props}>
        {children}
        {!fixedFooter ? renderedFooter : null}
      </ScreenContainer>
      {fixedFooter ? <View style={styles.footerOutside}>{renderedFooter}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.xl },
  footer: { width: '100%' },
  footerOutside: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm, paddingTop: Spacing.sm },
});
