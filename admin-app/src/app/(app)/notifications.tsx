import { getPushToken, rolesOf, setPushNotify } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';

import { Card, Loader, PRIMARY, Screen, SectionTitle } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { useT } from '@/lib/i18n';

/**
 * Self-service notification control, available to EVERY signed-in employee. Order
 * servers (sales) who only deliver — while the owner accepts — can switch their
 * new-order alerts off here. Persists `notify` on the user's pushTokens doc, which
 * the notify Worker honours when fanning out order notifications.
 */
export default function NotificationsScreen() {
  const { appUser, user } = useAuth();
  const t = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const inited = useRef(false);

  useEffect(() => {
    if (!user || inited.current) return;
    inited.current = true;
    void (async () => {
      try {
        const tok = await getPushToken(user.uid);
        setEnabled(tok?.notify !== false);
      } catch {
        // default to on if we can't read it
      } finally {
        setLoaded(true);
      }
    })();
  }, [user]);

  async function onToggle(value: boolean) {
    if (!user) return;
    setSaving(true);
    setEnabled(value);
    try {
      // Re-register the device token (and current roles) when turning alerts on, so a
      // fresh token exists for the server to target; then persist the preference.
      if (value) await registerForPush(user.uid, appUser ? rolesOf(appUser) : null);
      await setPushNotify(user.uid, value);
      toast({
        type: 'success',
        title: t('common.saved', 'Saved ✓'),
        message: value
          ? t('notif.onMsg', "You'll receive order alerts on this device.")
          : t('notif.offMsg', 'Order alerts are off on this device.'),
      });
    } catch {
      setEnabled(!value); // revert on failure
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('notif.title', 'Notifications') }} />
      <SectionTitle>{t('notif.orders', 'Order notifications')}</SectionTitle>
      {!loaded ? (
        <Loader label={t('common.loading', 'Loading…')} />
      ) : (
        <Card style={{ gap: Spacing.two }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{t('notif.ordersLabel', 'New order alerts')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t(
                  'notif.ordersHint',
                  'Turn off if you only deliver orders and someone else accepts them. You can turn it back on anytime.',
                )}
              </ThemedText>
            </View>
            <Switch
              value={enabled}
              disabled={saving}
              onValueChange={(v) => void onToggle(v)}
              trackColor={{ true: PRIMARY }}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}
