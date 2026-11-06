import {
  buyerCancelOrder,
  COURIER_UPDATE_INTERVAL_MS,
  fetchCustomerOrdersPage,
  getOrder,
  ORDER_STATUS_LABELS,
  orderDisplayCode,
  orderMatchesCode,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@common';
import { router, Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, StyleSheet, View } from 'react-native';

import { useConfirm, useToast } from '@/components/feedback';
import { Badge, Button, Card, DANGER, EmptyState, Loader, PRIMARY, Screen, SUCCESS, TextField } from '@/components/kit';
import { DeliveryMap } from '@/components/delivery-map';
import { OrderReview } from '@/components/order-review';
import { OrderStatusAnimation } from '@/components/order-status-animation';
import { OrderTimeline } from '@/components/order-timeline';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { shareInvoice } from '@/lib/invoice';
import { logError } from '@/lib/logging';
import { useT } from '@/lib/i18n';

const money = (n: number) => `₹${n.toFixed(2)}`;
const PAGE_SIZE = 10;
/** Amber used for the "running late" badge (matches the accepted/claimed accents elsewhere). */
const AMBER = '#F5A623';

/** Opaque Firestore pagination cursor, inferred from the repo API (no direct firebase import). */
type Cursor = Awaited<ReturnType<typeof fetchCustomerOrdersPage>>['cursor'];

const STATUS_COLOR: Record<OrderStatus, string> = {
  new: PRIMARY,
  accepted: PRIMARY,
  packed: PRIMARY,
  out_for_delivery: PRIMARY,
  served: SUCCESS,
  cancelled: DANGER,
};

const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  pending: DANGER,
  claimed: PRIMARY,
  verified: SUCCESS,
};

/**
 * On-time / running-late pill for an in-progress order. The flag is set by the
 * sales/delivery person in the admin app; absent/false reads as "On time". Shows nothing
 * once the order is new, served, or cancelled, where lateness no longer applies.
 */
function ProgressBadge({ order }: Readonly<{ order: Order }>) {
  const t = useT();
  if (order.status !== 'accepted' && order.status !== 'packed' && order.status !== 'out_for_delivery') return null;
  return (
    <Badge
      label={order.runningLate ? t('orders.runningLate', 'Running late') : t('orders.onTime', 'On time')}
      color={order.runningLate ? AMBER : SUCCESS}
    />
  );
}

/**
 * Live delivery map shown inline inside an order card's expanded section (replaces the status
 * animation while "Track on map" is active). Reads straight off the order; the parent polls and
 * refreshes the order, so the courier pin and badges move in place.
 */
function InlineTrack({ order }: Readonly<{ order: Order }>) {
  const t = useT();
  const courier =
    order.courierLat != null && order.courierLng != null
      ? { lat: order.courierLat, lng: order.courierLng }
      : null;
  const dest =
    order.address?.lat != null && order.address?.lng != null
      ? { lat: order.address.lat, lng: order.address.lng }
      : null;

  if (!courier) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {t('track.waitingHint', 'Waiting for the delivery partner to start moving. This updates automatically.')}
      </ThemedText>
    );
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <DeliveryMap courier={courier} dest={dest} height={300} />
      <View style={{ flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' }}>
        <ThemedText type="small" themeColor="textSecondary">
          🛵 {t('track.courier', 'Delivery partner')}
        </ThemedText>
        {dest ? (
          <ThemedText type="small" themeColor="textSecondary">
            🏠 {t('track.you', 'You')}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export default function Orders() {
  const { user } = useAuth();
  const t = useT();
  const cart = useCart();
  const confirm = useConfirm();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<Cursor>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [firstLoaded, setFirstLoaded] = useState(false);
  /** Order whose status timeline is currently expanded (only one at a time). */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Order whose expanded section is showing the live map (replaces the animation). */
  const [mapId, setMapId] = useState<string | null>(null);
  /** Free-text order-code search over the loaded pages. */
  const [search, setSearch] = useState('');

  const visibleOrders = useMemo(
    () => orders.filter((o) => orderMatchesCode(o, search)),
    [orders, search],
  );

  // While a card's live map is open, re-read just that order on the courier cadence so the pin
  // and badges refresh in place — ONLY while this tab is focused and the app is foregrounded, so
  // no reads are spent otherwise. Mirrors the courier write cadence.
  useFocusEffect(
    useCallback(() => {
      if (!mapId) return;
      let active = true;
      let timer: ReturnType<typeof setInterval> | null = null;
      const poll = async () => {
        try {
          const fresh = await getOrder(mapId);
          if (active && fresh) setOrders((prev) => prev.map((x) => (x.id === mapId ? fresh : x)));
        } catch {
          // transient; next tick retries
        }
      };
      const start = () => {
        if (timer) return;
        void poll();
        timer = setInterval(() => void poll(), COURIER_UPDATE_INTERVAL_MS);
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      start();
      const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
      return () => {
        active = false;
        stop();
        sub.remove();
      };
    }, [mapId]),
  );

  const downloadBill = useCallback(
    async (o: Order) => {
      try {
        await shareInvoice(o);
      } catch (e) {
        logError('orders.bill', e, { orderId: o.id });
        toast({
          type: 'error',
          title: t('orders.billFailed', 'Could not create bill'),
          message: t('common.tryAgain', 'Please try again.'),
        });
      }
    },
    [toast, t],
  );

  const reorder = useCallback(
    (o: Order) => {
      o.items.forEach((i) =>
        cart.add({ productId: i.productId, name: i.name, price: i.price, qty: i.qty, unit: i.unit }),
      );
      toast({
        type: 'success',
        title: t('orders.reordered', 'Added to cart'),
        message: t('orders.reorderedHint', 'Review your cart and check out.'),
      });
      router.push('/checkout');
    },
    [cart, toast, t],
  );

  const cancel = useCallback(
    async (o: Order) => {
      if (!user) return;
      const ok = await confirm({
        title: t('orders.cancelTitle', 'Cancel order?'),
        message: t('orders.cancelConfirm', 'This order will be cancelled. This cannot be undone.'),
        confirmText: t('orders.cancelConfirmBtn', 'Cancel order'),
        cancelText: t('orders.keepBtn', 'Keep'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await buyerCancelOrder(o.id, { uid: user.uid, name: user.displayName ?? null });
        // Paginated list (not a live subscription) — update the row in place.
        setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: 'cancelled' } : x)));
      } catch {
        toast({
          type: 'error',
          title: t('orders.cancelFailed', 'Could not cancel'),
          message: t('common.tryAgain', 'Please try again.'),
        });
      }
    },
    [user, confirm, toast, t],
  );

  const loadFirst = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const page = await fetchCustomerOrdersPage(user.uid, PAGE_SIZE);
      setOrders(page.orders);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
      setFirstLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!user || loading || refreshing || !hasMore) return;
    setLoading(true);
    try {
      const page = await fetchCustomerOrdersPage(user.uid, PAGE_SIZE, cursor);
      setOrders((prev) => [...prev, ...page.orders]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  }, [user, loading, refreshing, hasMore, cursor]);

  const onRefresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const page = await fetchCustomerOrdersPage(user.uid, PAGE_SIZE);
      setOrders(page.orders);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  const renderItem = useCallback(({ item: o }: { item: Order }) => {
    const summary = o.items.map((i) => `${i.name} × ${i.qty}`).join(', ');
    const date = o.createdAt?.toDate();
    const delta = o.amountDelta ?? 0;
    const payMode = o.paymentMode ?? 'cod';
    const payStatus = o.paymentStatus ?? 'pending';
    let deltaMsg = '';
    if (delta < 0) {
      deltaMsg =
        payMode === 'upi'
          ? t('orders.refundUpi', 'Refund {amount} to your UPI', { amount: money(Math.abs(delta)) })
          : t('orders.lessCod', 'Pay {amount} less on delivery', { amount: money(Math.abs(delta)) });
    } else if (delta > 0) {
      deltaMsg =
        payMode === 'upi'
          ? t('orders.payMoreUpi', 'Pay {amount} more for the added items', { amount: money(delta) })
          : t('orders.payExtraCod', 'Pay {amount} extra on delivery', { amount: money(delta) });
    }
    return (
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {t('orders.idLabel', 'Order ID')}: #{orderDisplayCode(o)}
        </ThemedText>
        <View style={styles.header}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {money(o.grandTotal ?? o.total)}
          </ThemedText>
          <ProgressBadge order={o} />
          <Badge label={ORDER_STATUS_LABELS[o.status]} color={STATUS_COLOR[o.status]} />
        </View>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {PAYMENT_MODE_LABELS[payMode]}
          </ThemedText>
          <Badge label={PAYMENT_STATUS_LABELS[payStatus]} color={PAYMENT_STATUS_COLOR[payStatus]} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {summary}
        </ThemedText>
        {date ? (
          <ThemedText type="small" themeColor="textSecondary">
            {date.toLocaleString()}
          </ThemedText>
        ) : null}
        {delta !== 0 ? (
          <ThemedText type="small" style={{ color: delta < 0 ? SUCCESS : DANGER }}>
            {deltaMsg}
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          <Button
            title={t('orders.reorder', 'Reorder')}
            variant="secondary"
            size="sm"
            onPress={() => reorder(o)}
          />
          <Button
            title={expanded === o.id ? t('orders.hideTrack', 'Hide') : t('orders.track', 'Track')}
            variant="secondary"
            size="sm"
            onPress={() => {
              setMapId(null);
              setExpanded((cur) => (cur === o.id ? null : o.id));
            }}
          />
          {o.status === 'out_for_delivery' ? (
            <Button
              title={t('orders.trackMap', 'Track on map')}
              variant={mapId === o.id ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => {
                if (mapId === o.id) {
                  setMapId(null);
                  setExpanded(null);
                } else {
                  setExpanded(o.id);
                  setMapId(o.id);
                }
              }}
            />
          ) : null}
          <Button
            title={t('orders.downloadBill', 'Bill')}
            variant="secondary"
            size="sm"
            onPress={() => void downloadBill(o)}
          />
          {o.status === 'new' ? (
            <Button
              title={t('orders.cancel', 'Cancel')}
              variant="danger"
              size="sm"
              onPress={() => void cancel(o)}
            />
          ) : null}
        </View>
        {expanded === o.id ? (
          <View style={{ marginTop: Spacing.two, gap: Spacing.three }}>
            <OrderTimeline order={o} showActor={false} />
            {mapId === o.id ? (
              <InlineTrack order={o} />
            ) : (
              <OrderStatusAnimation status={o.status} />
            )}
          </View>
        ) : null}
        {o.status === 'served' ? <OrderReview order={o} user={user} /> : null}
      </Card>
    );
  }, [t, reorder, cancel, user, expanded, mapId, downloadBill]);

  return (
    <Screen scroll={false}>
      <Tabs.Screen options={{ title: t('orders.title', 'My Orders') }} />

      {!firstLoaded ? (
        <Loader label={t('orders.loading', 'Loading orders…')} />
      ) : (
        <FlatList
          data={visibleOrders}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            orders.length > 0 ? (
              <TextField
                value={search}
                onChangeText={setSearch}
                placeholder={t('orders.searchPlaceholder', 'Search by Order ID')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : undefined
          }
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            loading ? undefined : (
              <EmptyState
                title={search.trim() ? t('orders.noMatch', 'No matching orders') : t('orders.empty', 'No orders yet')}
                hint={
                  search.trim()
                    ? t('orders.noMatchHint', 'No order on a loaded page matches that ID. Pull to refresh or load more.')
                    : t('orders.emptyHint', 'Your placed orders will show up here.')
                }
              />
            )
          }
          ListFooterComponent={
            loading && !refreshing ? (
              <ActivityIndicator color={PRIMARY} style={{ marginVertical: Spacing.three }} />
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  listContent: { gap: Spacing.three, paddingBottom: Spacing.six },
});
