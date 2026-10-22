import {
  fetchCustomerOrdersPage,
  ORDER_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@common';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { Badge, Card, DANGER, EmptyState, Loader, PRIMARY, Screen, SUCCESS } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<Cursor>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [firstLoaded, setFirstLoaded] = useState(false);

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
      </Card>
    );
  }, [t]);

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
  listContent: { gap: Spacing.three, paddingBottom: Spacing.six },
});
