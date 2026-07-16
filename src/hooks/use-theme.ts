/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeMode } from '@/hooks/theme-mode-context';

export function useTheme() {
  const systemScheme = useColorScheme();
  const requestedMode = useThemeMode();
  const scheme = requestedMode === 'system' ? systemScheme : requestedMode;
  const theme = scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}
