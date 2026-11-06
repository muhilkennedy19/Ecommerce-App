import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';
import { startLogging } from '@/lib/logging';
import { ErrorBoundary } from '@/components/error-boundary';
import { FeedbackProvider } from '@/components/feedback';
// Side-effect import: registers the background courier-location task at module top-level, before
// any React tree mounts (required by expo-task-manager, incl. cold headless background launches).
import '@/lib/delivery-task';

// Installed before the first render so a crash inside a provider is still captured.
startLogging();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <I18nProvider>
            <FeedbackProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="sign-in" />
                <Stack.Screen name="(app)" />
              </Stack>
            </FeedbackProvider>
          </I18nProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
