import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/kit';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function SignIn() {
  const { user, signIn, configured } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href={'/home' as never} />;

  const onSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      toast({
        type: 'error',
        title: t('signin.failed', 'Sign-in failed'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false} style={styles.center}>
      <View style={styles.hero}>
        <ThemedText type="title">{t('signin.brand', 'Shop')}</ThemedText>
        <ThemedText type="subtitle">{t('signin.buyer', 'Buyer')}</ThemedText>
      </View>

      {!configured ? (
        <Card>
          <ThemedText type="smallBold">{t('signin.setupRequired', 'Setup required')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(
              'signin.setupHint',
              'Replace the REPLACE_ME values in {path} with your Firebase config and Google web client ID, then reload. See the README.',
              { path: 'buyer-app/app.json > expo.extra' },
            )}
          </ThemedText>
        </Card>
      ) : (
        <View style={{ gap: Spacing.two }}>
          <Button title={t('signin.google', 'Sign in with Google')} onPress={onSignIn} loading={busy} />
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {t('signin.subtitle', 'Sign in to browse the shop and place orders.')}
          </ThemedText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', gap: Spacing.five },
  hero: { alignItems: 'center' },
});
