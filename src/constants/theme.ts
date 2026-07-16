/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

export const Colors = {
  light: {
    background: '#F5F7F4',
    surface: '#FFFFFF',
    surfaceElevated: '#EDF2EF',
    textPrimary: '#1A211F',
    textSecondary: '#53615C',
    textMuted: '#6D7975',
    border: '#D4DDD8',
    divider: '#E3E9E5',
    primary: '#246B5E',
    primaryPressed: '#1B554A',
    primaryContainer: '#DCECE7',
    primaryText: '#FFFFFF',
    success: '#2D6A4F',
    warning: '#815700',
    danger: '#A9342B',
    dangerText: '#FFFFFF',
    dangerContainer: '#F9E4E1',
    disabled: '#A4AEAA',
    overlay: 'rgba(16, 24, 21, 0.48)',
    inputBackground: '#FFFFFF',
    inputFocused: '#246B5E',
    feeding: '#9A5B18',
    feedingContainer: '#F7E9D7',
    poop: '#687044',
    poopContainer: '#EAEDDC',
    pee: '#28758A',
    peeContainer: '#DDEEF2',
    sleep: '#5D6291',
    sleepContainer: '#E7E7F4',
    other: '#815E74',
    otherContainer: '#F0E4EB',
    text: '#1A211F',
    backgroundElement: '#EDF2EF',
    backgroundSelected: '#DCECE7',
  },
  dark: {
    background: '#101311',
    surface: '#181D1A',
    surfaceElevated: '#202722',
    textPrimary: '#F0F4F1',
    textSecondary: '#B3BDB8',
    textMuted: '#8E9993',
    border: '#35403A',
    divider: '#2A332F',
    primary: '#83CDBA',
    primaryPressed: '#6CB3A1',
    primaryContainer: '#21443B',
    primaryText: '#0D1F1B',
    success: '#83CFA0',
    warning: '#E2B86B',
    danger: '#FFB4AB',
    dangerText: '#32110D',
    dangerContainer: '#4C211C',
    disabled: '#68736E',
    overlay: 'rgba(0, 0, 0, 0.68)',
    inputBackground: '#181D1A',
    inputFocused: '#83CDBA',
    feeding: '#E0A25C',
    feedingContainer: '#3D2C19',
    poop: '#B8C282',
    poopContainer: '#30351F',
    pee: '#7FC4D3',
    peeContainer: '#19343B',
    sleep: '#B3B6EA',
    sleepContainer: '#292B49',
    other: '#D3A9C2',
    otherContainer: '#3C2935',
    text: '#F0F4F1',
    backgroundElement: '#202722',
    backgroundSelected: '#21443B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 4,
  control: 6,
  card: 8,
} as const;

export const Typography = {
  pageTitle: { fontSize: 30, lineHeight: 38, fontWeight: '700' as const },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  keyNumber: { fontSize: 24, lineHeight: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '700' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  error: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
} satisfies Record<string, TextStyle>;

export const Shadows = {
  card: '0 1px 3px rgba(25, 40, 34, 0.08)',
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
