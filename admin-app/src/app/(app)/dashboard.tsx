import {
  isStaleToday,
  ROLE_LABELS,
  rolesOf,
  subscribeOrders,
  subscribeProducts,
  userHasPermission,
  userHasRole,
  type Order,
  type Permission,
  type Product,
} from '@common';
import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Screen, SectionTitle } from '@/components/kit';
import { useConfirm } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

interface Section {
  href: string;
  titleKey: string;
  title: string;
  subKey: string;
  subtitle: string;
  perm: Permission;
  emoji: string;
}

const SECTIONS: Section[] = [
  { href: '/pos', titleKey: 'dash.pos', title: 'POS', subKey: 'dash.pos.sub', subtitle: 'Point of sale', perm: 'pos.use', emoji: '💳' },
  { href: '/products', titleKey: 'dash.products', title: 'Products', subKey: 'dash.products.sub', subtitle: 'Categories & items', perm: 'products.read', emoji: '🛒' },
  { href: '/orders', titleKey: 'dash.orders', title: 'Orders', subKey: 'dash.orders.sub', subtitle: 'Incoming & history', perm: 'orders.read', emoji: '📦' },
  { href: '/employees', titleKey: 'dash.employees', title: 'Employees', subKey: 'dash.employees.sub', subtitle: 'Onboard & manage', perm: 'employees.read', emoji: '👥' },
  { href: '/customers', titleKey: 'dash.customers', title: 'Customers', subKey: 'dash.customers.sub', subtitle: 'View & edit', perm: 'customers.read', emoji: '🧾' },
  { href: '/analytics', titleKey: 'dash.analytics', title: 'Analytics', subKey: 'dash.analytics.sub', subtitle: 'Trends & export', perm: 'analytics.read', emoji: '📈' },
  { href: '/settings', titleKey: 'dash.settings', title: 'Settings', subKey: 'dash.settings.sub', subtitle: 'Shop, hours, keys', perm: 'shop.config', emoji: '⚙️' },
  { href: '/roles', titleKey: 'dash.roles', title: 'Team & Roles', subKey: 'dash.roles.sub', subtitle: 'Assign roles', perm: 'roles.manage', emoji: '🧑‍💼' },
  { href: '/coupons', titleKey: 'dash.coupons', title: 'Coupons', subKey: 'dash.coupons.sub', subtitle: 'Discounts & offers', perm: 'sales.discount', emoji: '🏷️' },
];

function tsToDate(ts: { toDate: () => Date } | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

export default function Dashboard() {
  const { appUser, user, signOut } = useAuth();
  const t = useT();
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  // Same visibility as the Products tile; the screen itself gates editing on
  // products.write.
  const canSeeInventory = userHasPermission(appUser, 'products.read');
  const canSeeOrders = userHasPermission(appUser, 'orders.read');

  useEffect(() => {
    if (!canSeeInventory) return;
    return subscribeProducts(shopId, setProducts);
  }, [canSeeInventory]);

  useEffect(() => {
    if (!canSeeOrders) return;
    return subscribeOrders(shopId, setOrders);
  }, [canSeeOrders]);

  // No role yet → access pending.
  if (user && !appUser) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center', gap: Spacing.four }}>
        <Stack.Screen options={{ title: t('dash.title', 'Dashboard') }} />
        <Card>
          <ThemedText type="smallBold">{t('dash.accessPending', 'Access pending')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(
              'dash.accessPendingHint',
              "You're signed in as {email}, but no role has been assigned yet. Ask an admin to add you in the shop, then reload.",
              { email: user.email ?? '' },
            )}
          </ThemedText>
        </Card>
        <Button title={t('common.signOut', 'Sign out')} variant="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }

  // Badge count for the inventory tile: perishables needing a re-price plus
  // stock-tracked items not counted today.
  const inventoryStale = products.filter(
    (p) =>
      (p.perishable && isStaleToday(tsToDate(p.priceUpdatedAt))) ||
      (p.trackStock && isStaleToday(tsToDate(p.stockUpdatedAt))),
  );

  const visible = SECTIONS.filter((s) => userHasPermission(appUser, s.perm));

  // "Open" = still needs someone to act on it. Served and cancelled are done.
  const openOrders = orders.filter(
    (o) => o.status !== 'served' && o.status !== 'cancelled',
  ).length;
  // New orders are the urgent subset, so they drive the badge colour.
  const newOrders = orders.filter((o) => o.status === 'new').length;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('dash.title', 'Dashboard') }} />

      <Card>
        <ThemedText type="smallBold">
          {appUser?.name
            ? t('dash.helloName', 'Hello, {name}', { name: appUser.name })
            : t('dash.hello', 'Hello')}
        </ThemedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one }}>
          {rolesOf(appUser).map((r) => (
            <Badge key={r} label={ROLE_LABELS[r]} />
          ))}
        </View>
      </Card>

      <SectionTitle>{t('dash.manage', 'Manage')}</SectionTitle>
      {visible.length === 0 ? (
        <EmptyState title={t('dash.nothingTitle', 'Nothing to show')} hint={t('dash.nothingHint', 'Your role has no sections enabled.')} />
      ) : (
        <View style={styles.grid}>
          {canSeeInventory ? (
            <Link href={'/inventory' as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <View style={styles.tileTop}>
                    <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                      📋
                    </ThemedText>
                    {inventoryStale.length > 0 ? (
                      <Badge label={String(inventoryStale.length)} color="#F2A900" />
                    ) : null}
                  </View>
                  <ThemedText type="smallBold">{t('dash.inventory', 'Update inventory')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.inventory.sub', 'Daily price & stock')}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ) : null}
          {visible.map((s) => (
            <Link key={s.href} href={s.href as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <View style={styles.tileTop}>
                    <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                      {s.emoji}
                    </ThemedText>
                    {s.href === '/orders' && openOrders > 0 ? (
                      <Badge
                        label={String(openOrders)}
                        color={newOrders > 0 ? DANGER : '#F2A900'}
                      />
                    ) : null}
                  </View>
                  <ThemedText type="smallBold">{t(s.titleKey, s.title)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {s.href === '/orders' && openOrders > 0
                      ? t('dash.orders.open', '{count} open', { count: openOrders })
                      : t(s.subKey, s.subtitle)}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ))}
          {userHasRole(appUser, 'superuser') ? (
            <Link href={'/purge' as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                    🧹
                  </ThemedText>
                  <ThemedText type="smallBold">{t('dash.purge', 'Purge data')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.purge.sub', 'Reset for onboarding')}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ) : null}

          {appUser ? (
            <Link href={'/notifications' as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                    🔔
                  </ThemedText>
                  <ThemedText type="smallBold">{t('dash.notifications', 'Notifications')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.notifications.sub', 'Order alerts on/off')}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ) : null}
        </View>
      )}

      <Button
        title={t('common.signOut', 'Sign out')}
        variant="secondary"
        onPress={() =>
          void (async () => {
            const ok = await confirm({
              title: t('common.signOut', 'Sign out'),
              message: t('dash.signOutConfirm', 'Are you sure?'),
              confirmText: t('common.signOut', 'Sign out'),
              cancelText: t('common.cancel', 'Cancel'),
              destructive: true,
            });
            if (ok) void signOut();
          })()
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
});
