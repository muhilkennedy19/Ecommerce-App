import {
  COURIER_UPDATE_INTERVAL_MS,
  getOrder,
  ORDER_STATUS_LABELS,
  type Order,
} from '@common';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Badge, Card, EmptyState, Loader, Screen, SUCCESS } from '@/components/kit';
import { DeliveryMap, type LatLng } from '@/components/delivery-map';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT, type TFunc } from '@/lib/i18n';

const AMBER = '#F5A623';

function latLng(lat?: number | null, lng?: number | null): LatLng | null {
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function formatAgo(from: number | null | undefined, now: number, t: TFunc): string {
  if (!from) return '';
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 60) return t('track.agoSec', 'updated {n}s ago', { n: s });
  const m = Math.round(s / 60);
  return t('track.agoMin', 'updated {n}m ago', { n: m });
}

/**
 * Live delivery map for one order. Polls the order on the shared courier cadence, but ONLY
 * while this screen is focused and the app is foregrounded — on blur/background the interval is
 * torn down so no reads are spent when the customer isn't watching.
 */
export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;

      const poll = async () => {
        try {
          const o = await getOrder(id);
          if (active) setOrder(o);
        } catch {
          // transient read failure — the next tick retries
        } finally {
          if (active) {
            setLoaded(true);
            setNow(Date.now());
          }
        }
      };

      const start = () => {
        if (pollRef.current) return;
        void poll();
        pollRef.current = setInterval(() => void poll(), COURIER_UPDATE_INTERVAL_MS);
        tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      };
      const stop = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (tickRef.current) clearInterval(tickRef.current);
        pollRef.current = null;
        tickRef.current = null;
      };

      start();
      const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
      return () => {
        active = false;
        stop();
        sub.remove();
      };
    }, [id]),
  );

  const title = t('track.title', 'Track delivery');

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Loader label={t('track.loading', 'Locating your order…')} />
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('order.notFound', 'Order not found')} />
      </Screen>
    );
  }

  const courier = latLng(order.courierLat, order.courierLng);
  const dest = latLng(order.address?.lat, order.address?.lng);
  const onTheRoad = order.status === 'out_for_delivery';

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      <Card style={{ gap: Spacing.two }}>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {ORDER_STATUS_LABELS[order.status]}
          </ThemedText>
          {onTheRoad ? (
            <Badge
              label={order.runningLate ? t('orders.runningLate', 'Running late') : t('orders.onTime', 'On time')}
              color={order.runningLate ? AMBER : SUCCESS}
            />
          ) : null}
        </View>
        {courier && order.courierUpdatedAt ? (
          <ThemedText type="small" themeColor="textSecondary">
            {formatAgo(order.courierUpdatedAt, now, t)}
          </ThemedText>
        ) : null}
      </Card>

      {!onTheRoad ? (
        <EmptyState
          title={t('track.notOut', 'Not out for delivery')}
          hint={t('track.notOutHint', 'Live tracking appears once your order is on the way.')}
        />
      ) : courier ? (
        <>
          <DeliveryMap courier={courier} dest={dest} height={360} />
          <View style={styles.legend}>
            <ThemedText type="small" themeColor="textSecondary">
              🛵 {t('track.courier', 'Delivery partner')}
            </ThemedText>
            {dest ? (
              <ThemedText type="small" themeColor="textSecondary">
                🏠 {t('track.you', 'You')}
              </ThemedText>
            ) : null}
          </View>
          {!dest ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('track.noDest', 'No delivery pin on this order — showing the delivery partner only.')}
            </ThemedText>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={t('track.waiting', 'Getting ready to roll')}
          hint={t('track.waitingHint', 'Waiting for the delivery partner to start moving. This updates automatically.')}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  legend: { flexDirection: 'row', gap: Spacing.four, marginTop: Spacing.one },
});
