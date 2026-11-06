import {
  isStaleToday,
  lowStockReport,
  ROLE_LABELS,
  rolesOf,
  subscribeOpenOrders,
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
  { href: '/contact', titleKey: 'dash.contact', title: 'Contact Details', subKey: 'dash.contact.sub', subtitle: 'Address, phone, map pin', perm: 'shop.config', emoji: '📇' },
  { href: '/store', titleKey: 'dash.store', title: 'Store Configuration', subKey: 'dash.store.sub', subtitle: 'Hours, delivery, subscriptions', perm: 'shop.config', emoji: '🏪' },
  { href: '/settings', titleKey: 'dash.settings', title: 'Settings', subKey: 'dash.settings.sub', subtitle: 'Language, logo, UPI', perm: 'shop.config', emoji: '⚙️' },
  { href: '/feedback', titleKey: 'dash.feedback', title: 'Feedback', subKey: 'dash.feedback.sub', subtitle: 'Reviews & ratings', perm: 'shop.config', emoji: '⭐' },
  { href: '/coupons', titleKey: 'dash.coupons', title: 'Coupons', subKey: 'dash.coupons.sub', subtitle: 'Discounts & offers', perm: 'sales.discount', emoji: '🏷️' },
  { href: '/loyalty', titleKey: 'dash.loyalty', title: 'Loyalty & referrals', subKey: 'dash.loyalty.sub', subtitle: 'Points & invite rewards', perm: 'shop.config', emoji: '🎁' },
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
    // Bounded on purpose: the badge only ever counts orders still awaiting action, so there
    // is no reason to stream the shop's entire history into the dashboard.
    return subscribeOpenOrders(shopId, setOrders);
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

  // Every order on this feed is by definition still open; `new` is the urgent subset.
  const openOrders = orders.length;
  const newOrders = orders.filter((o) => o.status === 'new').length;

  // Stock needing a decision today: already sold out, or at/below its reorder level.
  const { out: outOfStock, low: lowStock } = lowStockReport(products);
  const stockAlerts = outOfStock.length + lowStock.length;

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
      {canSeeInventory && stockAlerts > 0 ? (
        <Link href={'/inventory?filter=low' as never} asChild>
          <Pressable>
            <Card style={{ backgroundColor: DANGER + '18', gap: Spacing.one }}>
              <View style={styles.tileTop}>
                <ThemedText type="smallBold" style={{ color: DANGER, flex: 1 }}>
                  {t('dash.stockAlert', 'Stock needs attention')}
                </ThemedText>
                <Badge label={String(stockAlerts)} color={DANGER} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('dash.stockAlertHint', '{out} out of stock · {low} running low — tap to restock', {
                  out: outOfStock.length,
                  low: lowStock.length,
                })}
              </ThemedText>
            </Card>
          </Pressable>
        </Link>
      ) : null}
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
            <Link href={'/products/port' as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                    📤
                  </ThemedText>
                  <ThemedText type="smallBold">{t('dash.port', 'Import / Export')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.port.sub', 'Products via Excel')}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ) : null}

          {userHasRole(appUser, 'superuser') ? (
            <Link href={'/usage' as never} asChild>
              <Pressable style={{ flexBasis: '47%', flexGrow: 1 }}>
                <Card style={{ gap: Spacing.one, minHeight: 96 }}>
                  <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                    📊
                  </ThemedText>
                  <ThemedText type="smallBold">{t('dash.usage', 'Firebase usage')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.usage.sub', 'Storage & document counts')}
                  </ThemedText>
                </Card>
              </Pressable>
            </Link>
          ) : null}

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
