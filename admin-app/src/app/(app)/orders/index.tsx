import {
  acceptOrder,
  buildOrderBillEmail,
  buildOrderServedEmail,
  cancelOrder,
  formatQty,
  getCustomer,
  getIdToken,
  getShop,
  ORDER_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
  sendEmail,
  sendNotify,
  setOrderPaymentVerified,
  setOrderStatus,
  subscribeOrders,
  userHasPermission,
  userHasRole,
  type Address,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@common';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  Loader,
  PRIMARY,
  Screen,
  SectionTitle,
  SUCCESS,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { notifyUrl, shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const ACCEPTED_COLOR = '#F5A623';
const OUT_FOR_DELIVERY_COLOR = '#8E4EC6';

/**
 * Run a status-change `action`, then fire a best-effort push to the customer once it
 * succeeds. Fire-and-forget: never blocks the UI, and swallows both action and push
 * failures (sendNotify is already a graceful no-op when push is not configured).
 */
function notifyOnStatus(action: Promise<unknown>, order: Order, status: OrderStatus): void {
  void (async () => {
    try {
      await action;
      await sendNotify(notifyUrl, await getIdToken(), {
        event: 'order-status',
        customerId: order.customerId,
        status,
        orderId: order.id,
      });
    } catch {
      // best-effort; the action's own UI handling (if any) stays unaffected
    }
  })();
}

/**
 * Once `accept` resolves, email the customer an itemized bill. Best-effort and
 * fire-and-forget: a missing email, unread shop/customer doc, or unconfigured Gmail
 * on the Worker all degrade to a silent no-op and never block the accept flow.
 */
function emailBillOnAccept(accept: Promise<unknown>, order: Order): void {
  void emailCustomerAfter(accept, order, buildOrderBillEmail);
}

/** Thank-you email once an order is served/delivered (best-effort, same no-op rules). */
function emailThanksOnServe(action: Promise<unknown>, order: Order): void {
  void emailCustomerAfter(action, order, buildOrderServedEmail);
}

/** Shared runner: await the action, resolve the customer's email + shop name, send. */
async function emailCustomerAfter(
  action: Promise<unknown>,
  order: Order,
  build: (opts: { order: Order; shopName: string }) => { subject: string; text: string; html?: string },
): Promise<void> {
  try {
    await action;
    const customer = await getCustomer(order.customerId);
    const to = customer?.email;
    if (!to) return;
    let shopName = 'Rajendran Fruit & Flower';
    try {
      const shop = await getShop(shopId);
      if (shop?.name) shopName = shop.name;
    } catch {
      // keep the default name if the shop doc can't be read
    }
    const body = build({ order, shopName });
    await sendEmail(notifyUrl, await getIdToken(), { to, fromName: shopName, ...body });
  } catch {
    // never surface an email failure into the order UI
  }
}

export const STATUS_COLOR: Record<OrderStatus, string> = {
  new: PRIMARY,
  accepted: ACCEPTED_COLOR,
  out_for_delivery: OUT_FOR_DELIVERY_COLOR,
  served: SUCCESS,
  cancelled: DANGER,
};

function formatTimestamp(ts: Order['createdAt']): string {
  return ts ? ts.toDate().toLocaleString() : '—';
}

const ACTIVE_STATUSES: OrderStatus[] = ['new', 'accepted', 'out_for_delivery'];

/**
 * Whether a non-admin order-server (e.g. sales) may see this order in their list:
 * any active order, plus completed orders THEY personally marked served. Cancelled
 * orders and others' past orders are hidden.
 */
function isVisibleToServer(order: Order, uid: string | undefined): boolean {
  if (ACTIVE_STATUSES.includes(order.status)) return true;
  if (order.status === 'served' && uid) {
    const servedByMe = (order.statusLog ?? []).some(
      (e) => e.status === 'served' && e.by === uid,
    );
    return servedByMe || order.assignedTo === uid;
  }
  return false;
}

function itemsSummary(order: Order): string {
  return order.items.map((i) => `${i.name} x${formatQty(i.qty, i.unit)}`).join(', ');
}

/** One-line human address from the order snapshot. */
export function formatAddress(a?: Address | null): string {
  if (!a) return '';
  const main = [a.door, a.street, a.city, a.pincode].filter(Boolean).join(', ');
  return a.landmark ? `${main} (${a.landmark})` : main;
}

/** Full contact block as a copy-friendly string: name + phone + address. */
export function contactCopyText(order: Order): string {
  const lines: string[] = [];
  if (order.customerName) lines.push(order.customerName);
  if (order.customerPhone) lines.push(order.customerPhone);
  const addr = formatAddress(order.address);
  if (addr) lines.push(addr);
  return lines.join('\n');
}

async function copyToClipboard(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

/**
 * Customer name/phone/address, shared by the list and detail screens. The copy
 * actions (and the Call button) render only when `showActions` is set — the list
 * shows the contact text alone and surfaces Call in its own per-order action row.
 */
export function ContactBlock({
  order,
  showActions = true,
}: Readonly<{ order: Order; showActions?: boolean }>) {
  const t = useT();
  const toast = useToast();
  const phone = order.customerPhone ?? undefined;
  const address = formatAddress(order.address);
  const onCopied = () => toast({ type: 'info', message: t('common.copied', 'Copied') });
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('orders.contact', 'Customer contact')}
      </ThemedText>
      <ThemedText type="smallBold">{order.customerName ?? t('common.customer', 'Customer')}</ThemedText>
      {phone ? <ThemedText type="small">{phone}</ThemedText> : null}
      {address ? (
        <ThemedText type="small" themeColor="textSecondary">
          {address}
        </ThemedText>
      ) : null}
      {showActions ? (
        <View style={{ flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' }}>
          {phone ? (
            <View style={{ flex: 1 }}>
              <Button title={t('orders.call', 'Call')} onPress={() => void Linking.openURL('tel:' + phone)} />
            </View>
          ) : null}
          {phone ? (
            <View style={{ flex: 1 }}>
              <Button
                title={t('orders.copyPhone', 'Copy phone')}
                variant="secondary"
                onPress={() => void copyToClipboard(phone).then(onCopied)}
              />
            </View>
          ) : null}
          {address ? (
            <View style={{ flex: 1 }}>
              <Button
                title={t('orders.copyAddress', 'Copy address')}
                variant="secondary"
                onPress={() => void copyToClipboard(contactCopyText(order)).then(onCopied)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Status badge color for the payment status. `pending` stays neutral (textSecondary-ish)
 * so the default (cod/pending) order doesn't scream red in every row. */
const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  verified: SUCCESS,
  claimed: '#F5A623',
  pending: '#60646C',
};

/**
 * Payment mode + status for an order, shared by the list and detail screens. Shows a
 * "Mark payment verified" action for UPI orders not yet verified (gated on orders.serve),
 * confirmed via the shared confirm dialog.
 */
export function PaymentBlock({ order }: Readonly<{ order: Order }>) {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const canServe = userHasPermission(useAuth().appUser, 'orders.serve');
  const mode = order.paymentMode ?? 'cod';
  const status: PaymentStatus = order.paymentStatus ?? 'pending';

  async function markVerified() {
    const ok = await confirm({
      title: t('payments.markReceived', 'Mark payment received'),
      message: t('payments.markReceivedConfirm', 'Confirm you have received payment for this order?'),
      confirmText: t('payments.markReceived', 'Mark payment received'),
      cancelText: t('common.cancel', 'Cancel'),
    });
    if (!ok) return;
    try {
      await setOrderPaymentVerified(order.id);
    } catch (e) {
      toast({ type: 'error', title: t('common.updateFailed', 'Update failed'), message: String(e) });
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ThemedText type="small" themeColor="textSecondary">
          {PAYMENT_MODE_LABELS[mode]}
        </ThemedText>
        <Badge label={PAYMENT_STATUS_LABELS[status]} color={PAYMENT_STATUS_COLOR[status]} />
      </View>
      {order.upiRef ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('payments.ref', 'Ref: {ref}', { ref: order.upiRef })}
        </ThemedText>
      ) : null}
      {status !== 'verified' && canServe ? (
        <Button
          title={
            mode === 'upi'
              ? t('payments.markVerified', 'Mark payment verified')
              : t('payments.markReceived', 'Mark payment received')
          }
          onPress={() => void markVerified()}
        />
      ) : null}
    </View>
  );
}

/**
 * Prominent warning shown next to an order's actions when it is a UPI order whose
 * payment has not yet been verified — nudging the shopkeeper to confirm receipt
 * before accepting. Renders nothing for COD orders or already-verified UPI orders.
 */
function UnverifiedPaymentWarning({ order }: Readonly<{ order: Order }>) {
  const t = useT();
  const mode = order.paymentMode ?? 'cod';
  const status: PaymentStatus = order.paymentStatus ?? 'pending';
  if (mode !== 'upi' || status === 'verified') return null;
  const claimed = status === 'claimed';
  return (
    <View style={{ flexDirection: 'row' }}>
      <Badge
        label={
          claimed
            ? t('pay.verifyClaimed', 'Customer marked paid — verify!')
            : t('pay.verifyPending', 'UPI payment pending')
        }
        color={claimed ? '#F5A623' : DANGER}
      />
    </View>
  );
}

export default function OrdersScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const confirm = useConfirm();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);

  const canRead = userHasPermission(appUser, 'orders.read');
  const canServe = userHasPermission(appUser, 'orders.serve');
  // Admins/superusers see the full order history. Everyone else (e.g. sales) sees only
  // active orders plus the completed orders THEY personally marked as served.
  const fullHistory = userHasRole(appUser, 'admin') || userHasRole(appUser, 'superuser');

  useEffect(() => {
    if (!canRead) return;
    return subscribeOrders(shopId, (o) => {
      setOrders(o);
      setLoaded(true);
    });
  }, [canRead]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('orders.title', 'Orders') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('orders.noViewHint', "Your role can't view orders.")} />
      </Screen>
    );
  }

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('orders.title', 'Orders') }} />
        <Loader label={t('orders.loading', 'Loading orders…')} />
      </Screen>
    );
  }

  // Orders this user may see in the list (full history for admins; active + own-served otherwise).
  const visibleOrders = fullHistory ? orders : orders.filter((o) => isVisibleToServer(o, appUser?.uid));
  const newOrders = visibleOrders.filter((o) => o.status === 'new');

  async function confirmCancel(order: Order) {
    const ok = await confirm({
      title: t('orders.cancel', 'Cancel order'),
      message: t('orders.cancelConfirm', 'Cancel this order? This cannot be undone.'),
      confirmText: t('orders.cancel', 'Cancel order'),
      cancelText: t('orders.keep', 'Keep'),
      destructive: true,
    });
    if (ok && appUser) notifyOnStatus(cancelOrder(order, appUser.uid, appUser.name), order, 'cancelled');
  }

  /**
   * Accept an order. For a UPI order whose payment is not yet verified, first make the
   * shopkeeper confirm they've actually received the money; COD / already-verified orders
   * accept immediately as before. Either way the existing accept + status push run on go.
   */
  async function handleAccept(order: Order) {
    if (!appUser) return;
    const needsVerify =
      order.paymentMode === 'upi' && (order.paymentStatus ?? 'pending') !== 'verified';
    if (needsVerify) {
      const ok = await confirm({
        title: t('pay.unverifiedTitle', 'Payment not verified'),
        message: t(
          'pay.unverifiedMsg',
          "Confirm you've received this UPI payment in your bank/UPI app before accepting the order.",
        ),
        confirmText: t('pay.acceptAnyway', 'Accept anyway'),
        cancelText: t('common.cancel', 'Cancel'),
      });
      if (!ok) return;
    }
    const accept = acceptOrder(order, appUser.uid, appUser.name);
    notifyOnStatus(accept, order, 'accepted');
    emailBillOnAccept(accept, order);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('orders.title', 'Orders') }} />

      {newOrders.length > 0 ? (
        <Card style={{ backgroundColor: PRIMARY + '22', gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: PRIMARY }}>
            {newOrders.length === 1
              ? t('orders.newBannerOne', '{count} new order — pick one up', { count: newOrders.length })
              : t('orders.newBannerMany', '{count} new orders — pick one up', { count: newOrders.length })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('orders.newBannerHint', 'New orders appear here in real time.')}
          </ThemedText>
        </Card>
      ) : null}

      <SectionTitle>{t('orders.all', 'All orders')}</SectionTitle>
      {visibleOrders.length === 0 ? (
        <EmptyState title={t('orders.noneTitle', 'No orders yet')} hint={t('orders.noneHint', 'Incoming orders will show up here.')} />
      ) : (
        visibleOrders.map((order) => (
          <Pressable key={order.id} onPress={() => router.push(('/orders/' + order.id) as never)}>
            <Card style={{ gap: Spacing.two }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ThemedText type="smallBold">{order.customerName ?? t('common.customer', 'Customer')}</ThemedText>
                <Badge label={ORDER_STATUS_LABELS[order.status]} color={STATUS_COLOR[order.status]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {itemsSummary(order)}
              </ThemedText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <ThemedText type="smallBold">₹{order.grandTotal ?? order.total}</ThemedText>
                  {order.amountDelta ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {order.amountDelta > 0
                        ? t('orders.adjustedUp', 'adjusted +₹{amount}', { amount: Math.abs(order.amountDelta) })
                        : t('orders.adjustedDown', 'adjusted −₹{amount}', { amount: Math.abs(order.amountDelta) })}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatTimestamp(order.createdAt)}
                </ThemedText>
              </View>

              <PaymentBlock order={order} />

              {canServe || canRead ? <ContactBlock order={order} showActions={false} /> : null}

              <UnverifiedPaymentWarning order={order} />

              {order.customerPhone ||
              (canServe &&
                (order.status === 'new' ||
                  order.status === 'accepted' ||
                  order.status === 'out_for_delivery')) ? (
                <View style={{ flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' }}>
                  {order.customerPhone ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('orders.call', 'Call')}
                        variant="secondary"
                        onPress={() => void Linking.openURL('tel:' + order.customerPhone)}
                      />
                    </View>
                  ) : null}
                  {canServe && order.status === 'new' ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('orders.accept', 'Accept')}
                        disabled={!appUser}
                        onPress={() => void handleAccept(order)}
                      />
                    </View>
                  ) : null}
                  {canServe && order.status === 'accepted' ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('orders.outForDelivery', 'Out for delivery')}
                        disabled={!appUser}
                        onPress={() =>
                          appUser &&
                          notifyOnStatus(
                            setOrderStatus(order.id, 'out_for_delivery', { uid: appUser.uid, name: appUser.name }),
                            order,
                            'out_for_delivery',
                          )
                        }
                      />
                    </View>
                  ) : null}
                  {canServe && order.status === 'out_for_delivery' ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('orders.markServed', 'Mark served')}
                        disabled={!appUser}
                        onPress={() => {
                          if (!appUser) return;
                          const served = setOrderStatus(order.id, 'served', { uid: appUser.uid, name: appUser.name });
                          notifyOnStatus(served, order, 'served');
                          emailThanksOnServe(served, order);
                        }}
                      />
                    </View>
                  ) : null}
                  {canServe &&
                  (order.status === 'new' ||
                    order.status === 'accepted' ||
                    order.status === 'out_for_delivery') ? (
                    <View style={{ flex: 1 }}>
                      <Button title={t('orders.reject', 'Reject')} variant="danger" onPress={() => void confirmCancel(order)} />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
