import {
  editOrderItems,
  effectivePrice,
  formatQty,
  fuzzyFilter,
  ORDER_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
  roundMoney,
  subscribeOrders,
  subscribeProducts,
  userHasPermission,
  type Order,
  type OrderItem,
  type Product,
} from '@common';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

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
  TextField,
} from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT, type TFn } from '@/lib/i18n';

import { ContactBlock, PaymentBlock, STATUS_COLOR } from './index';

type DraftRow = { productId: string; name: string; price: string; qty: string };

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function toDraft(items: OrderItem[]): DraftRow[] {
  return items.map((i) => ({
    productId: i.productId,
    name: i.name,
    price: String(i.price),
    qty: String(i.qty),
  }));
}

function toItems(rows: DraftRow[]): OrderItem[] {
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    price: Number(r.price) || 0,
    qty: Number(r.qty) || 0,
  }));
}

function deltaText(delta: number, t: TFn): string {
  if (delta > 0) return t('order.paysMore', 'Customer pays ₹{amount} more', { amount: Math.abs(delta) });
  if (delta < 0) return t('order.refund', 'Refund ₹{amount}', { amount: Math.abs(delta) });
  return t('order.noChange', 'No change to total');
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { appUser, user } = useAuth();
  const t = useT();
  const toast = useToast();
  const myUid = user?.uid;
  const canServe = userHasPermission(appUser, 'orders.serve');

  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [addQuery, setAddQuery] = useState('');

  useEffect(() => {
    return subscribeOrders(shopId, (o) => {
      setOrders(o);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!canServe) return;
    return subscribeProducts(shopId, setProducts);
  }, [canServe]);

  const order = orders.find((o) => o.id === id);

  // Seed the editable draft once the order first arrives.
  useEffect(() => {
    if (order && draft === null) setDraft(toDraft(order.items));
  }, [order, draft]);

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('order.title', 'Order') }} />
        <Loader label={t('order.loading', 'Loading order…')} />
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('order.title', 'Order') }} />
        <EmptyState title={t('order.notFound', 'Order not found')} hint={t('order.notFoundHint', 'It may have been removed.')} />
      </Screen>
    );
  }

  const rows = draft ?? toDraft(order.items);
  const liveItems = toItems(rows);
  const subtotal = liveItems.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = order.deliveryFee ?? 0;
  const newGrand = subtotal + deliveryFee;
  const prevGrand = order.grandTotal ?? order.total ?? 0;
  const pendingDelta = Math.round((newGrand - prevGrand) * 100) / 100;
  // Products the admin can add to this order (searchable; dupes just bump qty).
  const addable = fuzzyFilter(products, addQuery, (p) => [p.name]).slice(0, 10);

  function updateRow(idx: number, patch: Partial<DraftRow>) {
    setDraft((prev) => (prev ?? rows).map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setDraft((prev) => (prev ?? rows).filter((_, i) => i !== idx));
  }

  // Add a product to the order. If it's already a row, bump its quantity instead.
  function addProduct(p: Product) {
    setDraft((prev) => {
      const base = prev ?? rows;
      const existing = base.findIndex((r) => r.productId === p.id);
      if (existing >= 0) {
        return base.map((r, i) =>
          i === existing ? { ...r, qty: String((parseInt(r.qty, 10) || 0) + 1) } : r,
        );
      }
      return [
        ...base,
        { productId: p.id, name: p.name, price: String(effectivePrice(p)), qty: '1' },
      ];
    });
    setAddQuery('');
  }

  async function onSave() {
    if (!order || !myUid) return;
    const items = toItems(draft ?? rows);
    if (items.length === 0) {
      toast({ type: 'error', title: t('order.addItems', 'Add items'), message: t('order.addItemsHint', 'An order must have at least one item.') });
      return;
    }
    setSaving(true);
    try {
      await editOrderItems(order, items, myUid, Date.now());
      toast({ type: 'success', title: t('common.saved', 'Saved'), message: deltaText(pendingDelta, t) });
    } catch (e) {
      toast({ type: 'error', title: t('common.saveFailed', 'Save failed'), message: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  const changeLog = order.changeLog ?? [];
  const statusLog = [...(order.statusLog ?? [])].sort((a, b) => a.at - b.at);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('order.title', 'Order') }} />

      <Card style={{ gap: Spacing.two }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ThemedText type="smallBold">{order.customerName ?? t('common.customer', 'Customer')}</ThemedText>
          <Badge label={ORDER_STATUS_LABELS[order.status]} color={STATUS_COLOR[order.status]} />
        </View>
        <ContactBlock order={order} />
      </Card>

      <Card style={{ gap: Spacing.two }}>
        <PaymentBlock order={order} />
      </Card>

      {statusLog.length > 0 ? (
        <>
          <SectionTitle>{t('orders.trail', 'Status trail')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            {statusLog.map((entry, idx) => (
              <ThemedText key={idx} type="small">
                {`${ORDER_STATUS_LABELS[entry.status]} · ${entry.byName ?? 'Someone'} · ${new Date(
                  entry.at,
                ).toLocaleString()}`}
              </ThemedText>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('order.items', 'Items')}</SectionTitle>
      <Card style={{ gap: Spacing.three }}>
        {canServe ? (
          <>
            {rows.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('order.noItems', 'No items — add at least one before saving.')}
              </ThemedText>
            ) : (
              rows.map((r, idx) => (
                <View key={r.productId + idx} style={{ gap: Spacing.two }}>
                  <ThemedText type="smallBold">{r.name}</ThemedText>
                  <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label={t('order.qty', 'Qty')}
                        keyboardType="numeric"
                        value={r.qty}
                        onChangeText={(text) => updateRow(idx, { qty: text })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label={t('order.priceField', 'Price (₹)')}
                        keyboardType="numeric"
                        value={r.price}
                        onChangeText={(text) => updateRow(idx, { price: text })}
                      />
                    </View>
                  </View>
                  <Button title={t('order.remove', 'Remove')} variant="danger" onPress={() => removeRow(idx)} />
                </View>
              ))
            )}

            <View style={{ gap: Spacing.two }}>
              <ThemedText type="smallBold">{t('order.addProduct', 'Add a product')}</ThemedText>
              <TextField
                value={addQuery}
                onChangeText={setAddQuery}
                placeholder={t('order.searchProducts', 'Search products to add')}
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                {addable.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => addProduct(p)}
                    style={{
                      borderWidth: 1,
                      borderColor: PRIMARY,
                      borderRadius: 999,
                      paddingHorizontal: Spacing.three,
                      paddingVertical: Spacing.one + 2,
                    }}
                  >
                    <ThemedText type="small" style={{ color: PRIMARY }}>
                      {p.name} · ₹{effectivePrice(p)}
                    </ThemedText>
                  </Pressable>
                ))}
                {addQuery.trim() && addable.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('order.noProducts', 'No matching products')}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">{t('order.subtotal', 'Subtotal')}</ThemedText>
              <ThemedText type="smallBold">₹{subtotal}</ThemedText>
            </View>
            {deliveryFee ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('order.delivery', 'Delivery')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ₹{deliveryFee}
                </ThemedText>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">{t('order.newTotal', 'New total')}</ThemedText>
              <ThemedText type="smallBold">₹{newGrand}</ThemedText>
            </View>
            {pendingDelta !== 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {deltaText(pendingDelta, t)}
              </ThemedText>
            ) : null}

            <Button
              title={t('order.saveChanges', 'Save changes')}
              loading={saving}
              disabled={!myUid || rows.length === 0}
              onPress={() => void onSave()}
            />
          </>
        ) : (
          <>
            {order.items.map((i, idx) => (
              <View
                key={i.productId + idx}
                style={{ flexDirection: 'row', justifyContent: 'space-between' }}
              >
                <ThemedText type="small">
                  {i.name} x{formatQty(i.qty, i.unit)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ₹{roundMoney(i.price * i.qty)}
                </ThemedText>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="small">{t('order.subtotal', 'Subtotal')}</ThemedText>
              <ThemedText type="small">
                ₹{order.subtotal ?? order.items.reduce((s, i) => s + i.price * i.qty, 0)}
              </ThemedText>
            </View>
            {order.discount ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText type="small">
                  {order.couponCode
                    ? t('order.discountCoupon', 'Discount ({code})', { code: order.couponCode })
                    : t('order.discount', 'Discount')}
                </ThemedText>
                <ThemedText type="small" style={{ color: SUCCESS }}>
                  −₹{order.discount}
                </ThemedText>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="small">{t('order.delivery', 'Delivery')}</ThemedText>
              <ThemedText type="small">
                {order.deliveryFee ? '₹' + order.deliveryFee : t('order.free', 'FREE')}
              </ThemedText>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">{t('order.total', 'Total')}</ThemedText>
              <ThemedText type="smallBold">₹{order.grandTotal ?? order.total}</ThemedText>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('order.payment', 'Payment')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {PAYMENT_MODE_LABELS[order.paymentMode ?? 'cod']}
                {order.paymentStatus ? ' · ' + PAYMENT_STATUS_LABELS[order.paymentStatus] : ''}
              </ThemedText>
            </View>
          </>
        )}
      </Card>

      {order.amountDelta ? (
        <View style={{ gap: Spacing.one }}>
          <Badge
            label={
              order.amountDelta > 0
                ? t('order.netAdjustUp', 'Net adjustment +₹{amount}', { amount: Math.abs(order.amountDelta) })
                : t('order.netAdjustDown', 'Net adjustment −₹{amount}', { amount: Math.abs(order.amountDelta) })
            }
            color={order.amountDelta > 0 ? DANGER : SUCCESS}
          />
          {(order.paymentMode ?? 'cod') === 'upi' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {order.amountDelta > 0
                ? t('order.upiCollect', 'UPI order — collect ₹{amount} more from the customer.', { amount: Math.abs(order.amountDelta) })
                : t('order.upiRefund', 'UPI order — refund ₹{amount} to the customer.', { amount: Math.abs(order.amountDelta) })}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('order.codAdjust', 'COD — collect the adjusted total at delivery.')}
            </ThemedText>
          )}
        </View>
      ) : null}

      {changeLog.length > 0 ? (
        <>
          <SectionTitle>{t('order.changeHistory', 'Change history')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            {changeLog.map((c, idx) => (
              <View
                key={idx}
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two }}
              >
                <ThemedText type="small" style={{ flex: 1 }}>
                  {c.note}
                </ThemedText>
                {c.delta ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {c.delta > 0 ? '+' : '−'}₹{Math.abs(c.delta)}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
