import { addSubscription, type Address, type Customer, type OrderItem, type Weekday } from '@common';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useToast, useConfirm } from '@/components/feedback';
import { Button, Card, PRIMARY, SectionTitle } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

type Mode = 'once' | 'recurring';
type Freq = 'daily' | 'weekly';

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => `₹${Math.round(n)}`;

/** First absolute fire time from the buyer's choices (local → absolute). */
function computeNextRun(mode: Mode, freq: Freq, weekday: number, date: Date, time: Date): Date | null {
  const h = time.getHours();
  const m = time.getMinutes();
  const now = new Date();
  if (mode === 'once') {
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d > now ? d : null;
  }
  if (freq === 'daily') {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  const d = new Date();
  d.setHours(h, m, 0, 0);
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0 && d <= now) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, { backgroundColor: active ? PRIMARY : theme.backgroundSelected, opacity: disabled ? 0.4 : 1 }]}
    >
      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Cart-level subscription: turn the current cart into a standing/scheduled order, delivered
 * free. Only usable once the cart subtotal reaches the shop's `minOrder`; below that it shows
 * how much more is needed. Address + payment come from the checkout selections.
 */
export function CartSubscribe({
  items,
  subtotal,
  minOrder,
  address,
  user,
  customer,
  onCreated,
}: {
  items: OrderItem[];
  subtotal: number;
  minOrder: number;
  address: Address | null;
  user: { uid: string; displayName?: string | null } | null;
  customer: Customer | null;
  onCreated: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('recurring');
  const [freq, setFreq] = useState<Freq>('daily');
  const [weekday, setWeekday] = useState(1);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!user || minOrder <= 0 || items.length === 0) return null;

  const reached = subtotal >= minOrder;

  // Below the threshold: just nudge the buyer, no form.
  if (!reached) {
    return (
      <>
        <SectionTitle>{t('subscribe.section', 'Subscriptions')}</SectionTitle>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {t('subscribe.addMore', 'Add {amount} more to subscribe for free repeat delivery.', {
              amount: money(minOrder - subtotal),
            })}
          </ThemedText>
        </Card>
      </>
    );
  }

  const submit = async () => {
    if (!address) {
      toast({
        type: 'error',
        title: t('subscribe.needAddress', 'Add an address first'),
        message: t('subscribe.needAddressHint', 'Add a delivery address in your Profile to subscribe.'),
      });
      return;
    }
    const nextRun = computeNextRun(mode, freq, weekday, date, time);
    if (!nextRun) {
      toast({
        type: 'error',
        title: t('subscribe.pastDate', 'Pick a future date'),
        message: t('subscribe.pastDateHint', 'The delivery date and time must be in the future.'),
      });
      return;
    }
    // Subscriptions are Cash on Delivery: UPI can't be auto-charged for recurring/scheduled
    // orders, so make that explicit before creating one.
    const ok = await confirm({
      title: t('subscribe.codTitle', 'Cash on delivery'),
      message: t(
        'subscribe.codMsg',
        "We don't support automatic UPI for subscriptions — these are created as Cash on Delivery orders.",
      ),
      confirmText: t('subscribe.codConfirm', 'Got it, subscribe'),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await addSubscription(
        {
          shopId,
          customerId: user.uid,
          customerName: user.displayName ?? null,
          customerPhone: customer?.phone ?? null,
          items,
          subtotal,
          address,
          pincode: address.pincode ?? null,
          paymentMode: 'cod',
          note: null,
          mode,
          time: `${pad(time.getHours())}:${pad(time.getMinutes())}`,
          frequency: mode === 'recurring' ? freq : null,
          weekdays: mode === 'recurring' && freq === 'weekly' ? [WEEKDAYS[weekday]] : null,
          date: mode === 'once' ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : null,
          active: true,
        },
        nextRun,
      );
      setOpen(false);
      onCreated();
      toast({
        type: 'success',
        title: t('subscribe.created', 'Subscription created'),
        message: t('subscribe.createdHint', 'Manage it anytime from your Profile.'),
      });
    } catch {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: t('common.tryAgain', 'Please try again.') });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <>
        <SectionTitle>{t('subscribe.section', 'Subscriptions')}</SectionTitle>
        <Button title={t('subscribe.cta', 'Subscribe for delivery')} variant="secondary" onPress={() => setOpen(true)} />
      </>
    );
  }

  const timeLabel = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  const dateLabel = date.toLocaleDateString();

  return (
    <>
      <SectionTitle>{t('subscribe.title', 'Subscribe for delivery')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('subscribe.freeDelivery', 'Subscription orders are delivered free.')}
        </ThemedText>
        <View style={styles.row}>
          <Chip label={t('subscribe.once', 'Just once')} active={mode === 'once'} onPress={() => setMode('once')} />
          <Chip label={t('subscribe.repeat', 'Repeat')} active={mode === 'recurring'} onPress={() => setMode('recurring')} />
        </View>

        {mode === 'once' ? (
          <View style={styles.row}>
            <Button title={`${t('subscribe.date', 'Date')}: ${dateLabel}`} variant="secondary" size="sm" onPress={() => setShowDate(true)} />
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <Chip label={t('subscribe.daily', 'Daily')} active={freq === 'daily'} onPress={() => setFreq('daily')} />
              <Chip label={t('subscribe.weekly', 'Weekly')} active={freq === 'weekly'} onPress={() => setFreq('weekly')} />
            </View>
            {freq === 'weekly' ? (
              <View style={styles.row}>
                {WEEKDAYS.map((w, i) => (
                  <Chip key={w} label={t(`weekday.${w}`, w.toUpperCase())} active={weekday === i} onPress={() => setWeekday(i)} />
                ))}
              </View>
            ) : null}
          </>
        )}

        <View style={styles.row}>
          <Button title={`${t('subscribe.time', 'Time')}: ${timeLabel}`} variant="secondary" size="sm" onPress={() => setShowTime(true)} />
        </View>

        {!address ? (
          <ThemedText type="small" style={{ color: PRIMARY }}>
            {t('subscribe.needAddressHint', 'Add a delivery address in your Profile to subscribe.')}
          </ThemedText>
        ) : null}

        <View style={styles.row}>
          <Button title={t('common.cancel', 'Cancel')} variant="secondary" onPress={() => setOpen(false)} />
          <Button title={t('subscribe.save', 'Subscribe')} onPress={() => void submit()} loading={saving} disabled={!address} />
        </View>
      </Card>

      {showDate ? (
        <DateTimePicker
          value={date}
          mode="date"
          minimumDate={new Date()}
          onChange={(_e, d) => {
            setShowDate(false);
            if (d) setDate(d);
          }}
        />
      ) : null}
      {showTime ? (
        <DateTimePicker
          value={time}
          mode="time"
          onChange={(_e, d) => {
            setShowTime(false);
            if (d) setTime(d);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999 },
});
