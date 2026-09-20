import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider, useAppState } from '@/application/app-state/app-state-provider';
import { handleFeedingReminderNavigation } from '@/application/reminders/feeding-reminder-navigation';
import { Colors } from '@/constants/theme';
import { ThemeModeProvider } from '@/hooks/theme-mode-context';
import { useTheme } from '@/hooks/use-theme';
import { RecordSaveFeedback } from '@/features/records/components/record-save-feedback';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const router = useRouter();
  const theme = useTheme();
  const { status, feedingReminderService } = useAppState();
  const handledNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  useEffect(() => {
    if (status !== 'ready' || !feedingReminderService) return undefined;
    const openToday = (identifier: string) => {
      handleFeedingReminderNavigation(
        identifier,
        handledNotificationIds.current,
        () => router.replace('/today'),
      );
    };
    void feedingReminderService.getLastNavigationResponse().then((response) => {
      if (!response) return;
      openToday(response.identifier);
      void feedingReminderService.clearLastNavigationResponse();
    });
    const subscription = feedingReminderService.subscribeToNavigationResponses((response) => {
      openToday(response.identifier);
    });
    return () => subscription.remove();
  }, [feedingReminderService, router, status]);

  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: theme.background },
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.primary,
      headerTitleStyle: { color: theme.textPrimary, fontSize: 18, fontWeight: '700' },
      headerShadowVisible: false,
    }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="baby-setup" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="feeding/new" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="feeding/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="poop/new" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="poop/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="pee/new" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="pee/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="sleep/new" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="sleep/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="other/new" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="other/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="export/csv" options={{ headerShown: true, title: '导出CSV' }} />
      <Stack.Screen name="backup" options={{ headerShown: true, title: '完整备份与恢复', gestureEnabled: false, headerBackButtonMenuEnabled: false }} />
    </Stack>
  );
}

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const { themeMode } = useAppState();
  const requested = themeMode === 'system' ? systemColorScheme : themeMode;
  const resolved = requested === 'dark' ? 'dark' : 'light';
  const colors = Colors[resolved];
  return (
    <ThemeModeProvider mode={themeMode}>
      <ThemeProvider value={{
        ...(resolved === 'dark' ? DarkTheme : DefaultTheme),
        colors: {
          ...(resolved === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
          background: colors.background,
          card: colors.surface,
          text: colors.textPrimary,
          border: colors.border,
          primary: colors.primary,
          notification: colors.danger,
        },
      }}>
        <StatusBar animated style={resolved === 'dark' ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </ThemeModeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppStateProvider>
        <AppThemeProvider>
          <View style={{ flex: 1 }}><RootNavigator /></View>
          <RecordSaveFeedback />
        </AppThemeProvider>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
