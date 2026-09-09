/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

export const Colors = {
  "light": {
    "background": "#FFFCFA",
    "surface": "#FFFFFF",
    "surfaceElevated": "#F7F0EC",
    "textPrimary": "#463835",
    "textSecondary": "#74645F",
    "textMuted": "#80716C",
    "primary": "#A55F5C",
    "primaryPressed": "#914D4B",
    "primaryText": "#FFFFFF",
    "primaryContainer": "#F8E8E3",
    "primaryOnContainer": "#914D4B",
    "border": "#D8CAC5",
    "divider": "#EDE2DC",
    "danger": "#A33F3B",
    "dangerText": "#FFFFFF",
    "dangerContainer": "#F9E5E1",
    "success": "#456A4E",
    "warning": "#805515",
    "disabled": "#AA9992",
    "feeding": "#B87425",
    "feedingContainer": "#FBEDDF",
    "poop": "#738254",
    "poopContainer": "#EDF1E3",
    "pee": "#277E97",
    "peeContainer": "#E5F3F8",
    "sleep": "#7969AE",
    "sleepContainer": "#EEE9FA",
    "other": "#AB687F",
    "otherContainer": "#F6E8ED",
    "overlay": "rgba(38, 25, 24, 0.48)",
    "inputBackground": "#FFFFFF",
    "inputFocused": "#A55F5C",
    "text": "#463835",
    "backgroundElement": "#F7F0EC",
    "backgroundSelected": "#F8E8E3",
    "observationYellow": "#F1C643",
    "observationGreen": "#839E68",
    "observationBrown": "#9D6B3A",
    "observationBlack": "#343433",
    "observationRed": "#BF5350",
    "observationOther": "#BCBCB8",
    "urinePale": "#F7E4A2",
    "urineYellow": "#F1C643",
    "urineDark": "#E3A52C"
  },
  "dark": {
    "background": "#1D1818",
    "surface": "#282020",
    "surfaceElevated": "#332828",
    "textPrimary": "#F7EDE7",
    "textSecondary": "#D4BFB9",
    "textMuted": "#B6A09A",
    "primary": "#DEA3A0",
    "primaryPressed": "#CB8E8B",
    "primaryText": "#2B1818",
    "primaryContainer": "#472B2C",
    "primaryOnContainer": "#F1C2BC",
    "border": "#67524F",
    "divider": "#463635",
    "danger": "#FFB4AB",
    "dangerText": "#381816",
    "dangerContainer": "#4C2522",
    "success": "#AFCEA3",
    "warning": "#E5BB79",
    "disabled": "#806D68",
    "feeding": "#E8B06A",
    "feedingContainer": "#3B2D20",
    "poop": "#B9CA94",
    "poopContainer": "#2E3524",
    "pee": "#8CCDDD",
    "peeContainer": "#21353E",
    "sleep": "#C0B4EB",
    "sleepContainer": "#312C46",
    "other": "#DBA6BB",
    "otherContainer": "#422A34",
    "overlay": "rgba(0, 0, 0, 0.64)",
    "inputBackground": "#282020",
    "inputFocused": "#DEA3A0",
    "text": "#F7EDE7",
    "backgroundElement": "#332828",
    "backgroundSelected": "#472B2C",
    "observationYellow": "#F1C643",
    "observationGreen": "#839E68",
    "observationBrown": "#9D6B3A",
    "observationBlack": "#343433",
    "observationRed": "#BF5350",
    "observationOther": "#BCBCB8",
    "urinePale": "#F7E4A2",
    "urineYellow": "#F1C643",
    "urineDark": "#E3A52C"
  }
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

export const Radius = { small: 8, control: 12, button: 16, card: 20, hero: 24 } as const;

export const Typography = {
  heroTitle: { fontSize: 48, lineHeight: 58, fontWeight: '700' },
  inputNumber: { fontSize: 40, lineHeight: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fieldLabel: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  pageTitle: { fontSize: 36, lineHeight: 44, fontWeight: '700' as const },
  sectionTitle: { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  keyNumber: { fontSize: 28, lineHeight: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
export const MaxContentWidth = 640;
