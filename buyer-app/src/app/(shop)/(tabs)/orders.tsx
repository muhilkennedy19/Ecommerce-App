import {
  buyerCancelOrder,
  fetchCustomerOrdersPage,
  ORDER_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@common';
import { router, Tabs } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { useConfirm, useToast } from '@/components/feedback';
import { Badge, Button, Card, DANGER, EmptyState, Loader, PRIMARY, Screen, SUCCESS } from '@/components/kit';
import { OrderReview } from '@/components/order-review';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { useT } from '@/lib/i18n';

const money = (n: number) => `₹${n.toFixed(2)}`;
const PAGE_SIZE = 10;

/** Opaque Firestore pagination cursor, inferred from the repo API (no direct firebase import). */
type Cursor = Awaited<ReturnType<typeof fetchCustomerOrdersPage>>['cursor'];

const STATUS_COLOR: Record<OrderStatus, string> = {
  new: PRIMARY,
  accepted: PRIMARY,
  out_for_delivery: PRIMARY,
  served: SUCCESS,
  cancelled: DANGER,
};

const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  pending: DANGER,
  claimed: PRIMARY,
  verified: SUCCESS,
};

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
        <View style={styles.header}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {money(o.grandTotal ?? o.total)}
          </ThemedText>
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
          {o.status === 'new' ? (
            <Button
              title={t('orders.cancel', 'Cancel')}
              variant="danger"
              size="sm"
              onPress={() => void cancel(o)}
            />
          ) : null}
        </View>
        {o.status === 'served' ? <OrderReview order={o} user={user} /> : null}
      </Card>
    );
  }, [t, reorder, cancel, user]);

  return (
    <Screen scroll={false}>
      <Tabs.Screen options={{ title: t('orders.title', 'My Orders') }} />

      {!firstLoaded ? (
        <Loader label={t('orders.loading', 'Loading orders…')} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            loading ? undefined : (
              <EmptyState
                title={t('orders.empty', 'No orders yet')}
                hint={t('orders.emptyHint', 'Your placed orders will show up here.')}
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
