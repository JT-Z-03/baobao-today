import { use } from 'react';
import type { KeyboardAvoidingViewProps } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaInsetsContext,
} from 'react-native-safe-area-context';

const NATIVE_STACK_HEADER_HEIGHT = {
  android: 56,
  ios: 44,
} as const;

export function keyboardAvoidingBehavior(os = process.env.EXPO_OS): KeyboardAvoidingViewProps['behavior'] {
  return os === 'ios' ? 'padding' : 'height';
}

export function formKeyboardVerticalOffset(
  os = process.env.EXPO_OS,
  safeAreaTop = 0,
  hasNativeHeader = true,
) {
  if (!hasNativeHeader) return 0;
  const headerHeight = os === 'ios'
    ? NATIVE_STACK_HEADER_HEIGHT.ios
    : NATIVE_STACK_HEADER_HEIGHT.android;
  return safeAreaTop + headerHeight;
}

export function useFormKeyboardVerticalOffset(hasNativeHeader = true) {
  const insets = use(SafeAreaInsetsContext);
  const safeAreaTop = insets?.top ?? initialWindowMetrics?.insets.top ?? 0;
  return formKeyboardVerticalOffset(process.env.EXPO_OS, safeAreaTop, hasNativeHeader);
}
