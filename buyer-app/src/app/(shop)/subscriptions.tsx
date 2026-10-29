import { deleteSubscription, setSubscriptionActive, subscribeMySubscriptions, type Subscription, type Weekday } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useConfirm, useToast } from '@/components/feedback';
import { Badge, Button, Card, EmptyState, Loader, PRIMARY, Screen, SUCCESS } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

type T = ReturnType<typeof useT>;

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayLabel(w: Weekday | undefined, t: T): string {
  return w ? t(`weekday.${w}`, w.toUpperCase()) : '';
}

function describe(s: Subscription, t: T): string {
  if (s.mode === 'once') return t('subscribe.summaryOnce', 'Once on {date} at {time}', { date: s.date ?? '', time: s.time });
  if (s.frequency === 'weekly')
    return t('subscribe.summaryWeekly', 'Every {day} at {time}', { day: weekdayLabel(s.weekdays?.[0], t), time: s.time });
  return t('subscribe.summaryDaily', 'Every day at {time}', { time: s.time });
}

/**
 * A fresh next-run when resuming a paused subscription — honouring its own schedule
 * (once date / weekly weekday / daily) so the Worker fires it on the right day, and never
 * in the past (which would make the cron fire it immediately).
 */
function resumeNextRun(s: Subscription): Date {
  const [hh, mm] = (s.time || '08:00').split(':').map((n) => Number(n) || 0);
  const now = new Date();

  if (s.mode === 'once') {
    if (s.date) {
      const [y, mo, da] = s.date.split('-').map((n) => Number(n) || 0);
      const d = new Date(y, Math.max(0, mo - 1), da || 1, hh, mm, 0, 0);
      if (d > now) return d;
    }
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }

  if (s.frequency === 'weekly') {
    const wd = s.weekdays?.length ? WEEKDAYS.indexOf(s.weekdays[0]) : 1;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    let add = (wd - d.getDay() + 7) % 7;
    if (add === 0 && d <= now) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }

  // daily
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

export default function Subscriptions() {
  const { user } = useAuth();
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [subs, setSubs] = useState<Subscription[] | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeMySubscriptions(user.uid, setSubs);
  }, [user]);

  const toggle = async (s: Subscription) => {
    try {
      await setSubscriptionActive(s.id, !s.active, s.active ? undefined : resumeNextRun(s));
    } catch {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: t('common.tryAgain', 'Please try again.') });
    }
  };

  const remove = async (s: Subscription) => {
    const ok = await confirm({
      title: t('subscribe.removeTitle', 'Cancel subscription?'),
      message: t('subscribe.removeMsg', 'This standing order will stop.'),
      destructive: true,
      confirmText: t('common.delete', 'Delete'),
    });
    if (!ok) return;
    try {
      await deleteSubscription(s.id);
    } catch {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: t('common.tryAgain', 'Please try again.') });
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('subscribe.manageTitle', 'My subscriptions') }} />
      {subs === null ? (
        <Loader />
      ) : subs.length === 0 ? (
        <EmptyState
          title={t('subscribe.empty', 'No subscriptions')}
          hint={t('subscribe.emptyHint', 'Subscribe to a product from its page to get it delivered on a schedule.')}
        />
      ) : (
        subs.map((s) => (
          <Card key={s.id} style={{ gap: Spacing.one }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {(s.items ?? []).map((i) => `${i.name} × ${i.qty}`).join(', ')}
              </ThemedText>
              <Badge
                label={s.active ? t('subscribe.activeBadge', 'Active') : t('subscribe.pausedBadge', 'Paused')}
                color={s.active ? SUCCESS : PRIMARY}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {describe(s, t)}
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one }}>
              <Button
                title={s.active ? t('subscribe.pause', 'Pause') : t('subscribe.resume', 'Resume')}
                variant="secondary"
                size="sm"
                onPress={() => void toggle(s)}
              />
              <Button title={t('common.delete', 'Delete')} variant="danger" size="sm" onPress={() => void remove(s)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
