import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { FeedbackProvider } from '@/components/feedback';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <I18nProvider>
          <FeedbackProvider>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="sign-in" />
              <Stack.Screen name="(shop)" />
            </Stack>
          </FeedbackProvider>
        </I18nProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
