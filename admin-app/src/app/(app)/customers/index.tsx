import { subscribeCustomers, subscribeOrders, userHasPermission, type Customer, type Order } from '@common';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Card, EmptyState, PRIMARY, Screen, SectionTitle } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const money = (n: number) => `₹${Math.round(n)}`;

/** Per-customer aggregates derived from live orders (no backend needed). */
interface Insight {
  orderCount: number;
  lifetimeValue: number;
  lastOrderAt: number | null;
}

type SortMode = 'name' | 'spend';

export default function CustomersScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const theme = useTheme();
  const canRead = userHasPermission(appUser, 'customers.read');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sort, setSort] = useState<SortMode>('name');

  useEffect(() => {
    if (!canRead) return;
    return subscribeCustomers(shopId, setCustomers);
  }, [canRead]);

  useEffect(() => {
    if (!canRead) return;
    return subscribeOrders(shopId, setOrders);
  }, [canRead]);

  // Group orders by customerId → lifetime value (non-cancelled), order count, last order.
  // Mirrors the Map-reduce aggregation used on the analytics screen.
  const insights = useMemo(() => {
    const map = new Map<string, Insight>();
    for (const o of orders) {
      if (!o.customerId) continue;
      const prev = map.get(o.customerId) ?? { orderCount: 0, lifetimeValue: 0, lastOrderAt: null };
      const at = o.createdAt?.toDate()?.getTime() ?? null;
      map.set(o.customerId, {
        orderCount: prev.orderCount + 1,
        lifetimeValue: prev.lifetimeValue + (o.status === 'cancelled' ? 0 : o.grandTotal ?? o.total),
        lastOrderAt: Math.max(prev.lastOrderAt ?? 0, at ?? 0) || null,
      });
    }
    return map;
  }, [orders]);

  const sorted = useMemo(() => {
    const list = [...customers];
    if (sort === 'spend') {
      list.sort((a, b) => (insights.get(b.id)?.lifetimeValue ?? 0) - (insights.get(a.id)?.lifetimeValue ?? 0));
    } else {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return list;
  }, [customers, insights, sort]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('customers.noViewHint', "Your role can't view customers.")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />

      <SectionTitle>{t('customers.title', 'Customers')}</SectionTitle>

      {customers.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          {(['name', 'spend'] as SortMode[]).map((m) => {
            const active = m === sort;
            return (
              <Pressable
                key={m}
                onPress={() => setSort(m)}
                style={{
                  paddingHorizontal: Spacing.three,
                  paddingVertical: Spacing.one,
                  borderRadius: 999,
                  backgroundColor: active ? PRIMARY : theme.backgroundSelected,
                }}
              >
                <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                  {m === 'name' ? t('customers.sortName', 'A–Z') : t('customers.sortSpend', 'Top spenders')}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {customers.length === 0 ? (
        <EmptyState
          title={t('customers.noneTitle', 'No customers yet')}
          hint={t('customers.noneHint', 'Customers appear here once they sign up.')}
        />
      ) : (
        sorted.map((c) => {
          const ins = insights.get(c.id);
          const last = ins?.lastOrderAt ? new Date(ins.lastOrderAt).toLocaleDateString() : null;
          return (
            <Card key={c.id} style={{ gap: Spacing.one }}>
              {/* Addresses live on the detail screen — the list stays scannable. */}
              <Pressable
                onPress={() => router.push(`/customers/${c.id}` as never)}
                style={{ gap: Spacing.one }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>
                    {c.name}
                  </ThemedText>
                  {ins && ins.lifetimeValue > 0 ? (
                    <Badge label={money(ins.lifetimeValue)} color={PRIMARY} />
                  ) : null}
                  <ThemedText type="small" themeColor="textSecondary">
                    ›
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.email}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.phone || t('customers.noPhone', 'No phone')}
                </ThemedText>
                {ins ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('customers.insight', '{count} orders · last {date}', {
                      count: ins.orderCount,
                      date: last ?? '—',
                    })}
                  </ThemedText>
                ) : null}
              </Pressable>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
