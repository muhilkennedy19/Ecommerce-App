import {
  deliveryFeeFor,
  evaluateCoupon,
  getCoupon,
  getCustomer,
  getIdToken,
  getZone,
  buildUpiUrl,
  isValidPhone,
  sanitizePhone,
  saveAddresses,
  setCustomerPhone,
  shopAcceptsOrders,
  // Phone OTP verification disabled for now (kept for later): OtpService, Fast2SmsSender
  placeOrder,
  sendNotify,
  subscribeCoupons,
  subscribeProducts,
  subscribeShop,
  type Address,
  type Coupon,
  type CouponResult,
  type Customer,
  type DeliveryZone,
  type OrderItem,
  type PaymentMode,
  type Product,
  type Shop,
} from '@common';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useToast } from '@/components/feedback';
import { Badge, Button, Card, DANGER, EmptyState, PRIMARY, Screen, SectionTitle, SUCCESS, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { notifyUrl, shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const money = (n: number) => `₹${n.toFixed(2)}`;

export default function Checkout() {
  const { user } = useAuth();
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const cart = useCart();

  // Phone OTP verification disabled for now (kept for later)
  // const otp = useMemo(() => new OtpService({ sender: new Fast2SmsSender() }), []);

  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [note, setNote] = useState('');
  // Inline phone entry when the customer has no saved phone.
  const [phoneInput, setPhoneInput] = useState('');
  // Phone OTP verification disabled for now (kept for later)
  // const [phone, setPhone] = useState('');
  // const [code, setCode] = useState('');
  // const [sending, setSending] = useState(false);
  // const [verifying, setVerifying] = useState(false);
  // const [otpSent, setOtpSent] = useState(false);
  // const [verified, setVerified] = useState(false);
  const [placing, setPlacing] = useState(false);

  // Payment
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cod');

  // Inline "add delivery address" form.
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [door, setDoor] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [label, setLabel] = useState('');

  // Coupons
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [appliedRes, setAppliedRes] = useState<CouponResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Delivery address + zone
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);

  useEffect(() => subscribeShop(shopId, setShop), []);
  useEffect(() => subscribeProducts(shopId, setProducts), []);
  useEffect(() => subscribeCoupons(shopId, setCoupons), []);
  const open = shopAcceptsOrders(shop);

  useEffect(() => {
    if (!user) return;
    let active = true;
    getCustomer(user.uid)
      .then((c) => {
        if (!active) return;
        setCustomer(c);
        setSelectedAddressId(c?.defaultAddressId ?? c?.addresses?.[0]?.id ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const addresses = customer?.addresses ?? [];
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null;
  const savedPhone = customer?.phone?.trim() ?? '';
  // Effective phone = saved phone, or the number typed inline on this screen.
  const effectivePhone = savedPhone || phoneInput.trim();
  // A phone is required and must be exactly 10 digits before an order can be placed.
  const hasPhone = isValidPhone(effectivePhone);

  useEffect(() => {
    if (!selectedAddress) {
      setZone(null);
      return;
    }
    let active = true;
    setZoneLoading(true);
    getZone(selectedAddress.pincode)
      .then((z) => {
        if (active) setZone(z);
      })
      .catch(() => {
        if (active) setZone(null);
      })
      .finally(() => {
        if (active) setZoneLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddressId, selectedAddress?.pincode]);

  const subtotal = cart.total;
  const serviceable = zone != null && zone.serviceable;
  const deliveryFee = zone != null && serviceable ? deliveryFeeFor(zone, subtotal) : 0;
  const defaultCoupons = coupons.filter((c) => c.active && c.showByDefault);
  const grandTotal = appliedRes ? appliedRes.grandTotal : subtotal + deliveryFee;
  const effectiveDeliveryFee = appliedRes ? appliedRes.deliveryFee : deliveryFee;

  // Whether the shop has a UPI VPA configured to accept UPI payments.
  const shopVpa = shop?.upiVpa?.trim() ?? '';
  const upiAvailable = !!shopVpa;

  // Re-evaluate an applied coupon whenever the subtotal or delivery fee changes
  // (e.g. the buyer switches to a differently-priced delivery zone).
  useEffect(() => {
    if (!appliedCoupon) return;
    const res = evaluateCoupon(appliedCoupon, subtotal, deliveryFee);
    if (res.valid) {
      setAppliedRes(res);
    } else {
      setAppliedCoupon(null);
      setAppliedRes(null);
      setCouponError(res.reason ?? t('checkout.couponInvalid', 'This coupon cannot be applied.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, deliveryFee, appliedCoupon]);

  const applyCode = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setApplying(true);
    setCouponError(null);
    try {
      const c = await getCoupon(trimmed);
      const res = evaluateCoupon(c, subtotal, deliveryFee);
      if (!res.valid) {
        setAppliedCoupon(null);
        setAppliedRes(null);
        setCouponError(res.reason ?? t('checkout.couponInvalid', 'This coupon cannot be applied.'));
      } else {
        setAppliedCoupon(c);
        setAppliedRes(res);
        setCouponCode(c?.code ?? trimmed);
        setCouponError(null);
      }
    } catch {
      setAppliedCoupon(null);
      setAppliedRes(null);
      setCouponError(t('checkout.couponError', 'Could not apply that coupon. Please try again.'));
    } finally {
      setApplying(false);
    }
  };

  const applyChip = (c: Coupon) => {
    setCouponCode(c.code);
    void applyCode(c.code);
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setAppliedRes(null);
    setCouponError(null);
    setCouponCode('');
  };


  /** Cart lines whose product is now missing, inactive, or out of stock. */
  const invalidLines = useMemo(
    () =>
      cart.lines.filter((l) => {
        const p = products.find((pr) => pr.id === l.productId);
        if (!p || !p.active) return true;
        return p.trackStock && (p.stock ?? 0) <= 0;
      }),
    [cart.lines, products],
  );

  // Phone OTP verification disabled for now (kept for later)
  // const sendOtp = async () => {
  //   if (!phone.trim()) return;
  //   setSending(true);
  //   try {
  //     await otp.request(phone.trim());
  //     setOtpSent(true);
  //     Alert.alert(t('checkout.codeSent', 'Code sent'), t('checkout.codeSentHint', 'Enter the code you received to verify your phone.'));
  //   } catch {
  //     Alert.alert(t('checkout.smsNotConfigured', 'SMS not configured yet'), t('checkout.smsUnavailable', 'Phone verification is unavailable right now. You can still place your order.'));
  //   } finally {
  //     setSending(false);
  //   }
  // };
  //
  // const verifyOtp = async () => {
  //   if (!code.trim()) return;
  //   setVerifying(true);
  //   try {
  //     const ok = await otp.verify(phone.trim(), code.trim());
  //     if (ok) {
  //       setVerified(true);
  //       Alert.alert(t('checkout.phoneVerified', 'Phone verified'), t('checkout.phoneVerifiedHint', 'Thanks — your phone number is verified.'));
  //     } else {
  //       Alert.alert(t('checkout.verifyFailed', 'Verification failed'), t('checkout.verifyFailedHint', 'That code is invalid or has expired.'));
  //     }
  //   } catch {
  //     Alert.alert(t('checkout.smsNotConfigured', 'SMS not configured yet'), t('checkout.smsUnavailable', 'Phone verification is unavailable right now. You can still place your order.'));
  //   } finally {
  //     setVerifying(false);
  //   }
  // };

  const saveNewAddress = async () => {
    if (!user) return;
    if (!door.trim() || !street.trim() || !city.trim() || !pincode.trim()) {
      toast({
        type: 'error',
        title: t('checkout.addressIncomplete', 'Missing details'),
        message: t('checkout.addressIncompleteHint', 'Please fill in door, street, city and pincode.'),
      });
      return;
    }
    const addr: Address = {
      id: 'a' + Date.now(),
      label: label.trim() || null,
      door: door.trim(),
      street: street.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
      landmark: landmark.trim() || null,
    };
    setSavingAddress(true);
    try {
      await saveAddresses(user.uid, [...(customer?.addresses ?? []), addr], addr.id);
      // Reflect the new address locally so the picker + zone lookup pick it up.
      setCustomer((prev) => ({
        ...(prev ?? ({} as Customer)),
        addresses: [...(prev?.addresses ?? []), addr],
        defaultAddressId: addr.id,
      }));
      setSelectedAddressId(addr.id); // triggers getZone(pincode) → serviceability → deliveryFeeFor
      setShowAddressForm(false);
      setDoor('');
      setStreet('');
      setCity('');
      setPincode('');
      setLandmark('');
      setLabel('');
    } catch (e) {
      toast({
        type: 'error',
        title: t('checkout.addressSaveFailed', 'Could not save address'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingAddress(false);
    }
  };

  const onPlaceOrder = async () => {
    if (!user || !selectedAddress || !hasPhone) return;
    const email = user.email ?? '';
    setPlacing(true);
    try {
      const items: OrderItem[] = cart.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        price: l.price,
        qty: l.qty,
      }));
      const orderId = await placeOrder({
        shopId,
        customerId: user.uid,
        customerName: user.displayName ?? email,
        items,
        note: note.trim() || null,
        address: selectedAddress,
        pincode: selectedAddress.pincode,
        deliveryFee: appliedRes ? appliedRes.deliveryFee : deliveryFee,
        couponCode: appliedCoupon?.code ?? null,
        discount: appliedRes?.discount ?? 0,
        customerPhone: effectivePhone,
        paymentMode,
      });
      // If the customer had no saved phone, persist the number they typed inline.
      if (!savedPhone && phoneInput.trim()) {
        await setCustomerPhone(user.uid, phoneInput.trim());
      }
      const orderTotal = grandTotal;
      cart.clear();
      // Fire-and-forget: notify the shop of the new order (graceful no-op if push unconfigured).
      void getIdToken().then((idToken) =>
        sendNotify(notifyUrl, idToken, { event: 'new-order', shopId, orderId }),
      );
      if (paymentMode === 'upi') {
        // Open the customer's UPI app to pay the shop. The order is already placed;
        // the shop verifies the payment manually before accepting it (no in-app confirm).
        try {
          await Linking.openURL(
            buildUpiUrl({
              vpa: shopVpa,
              payeeName: shop?.upiPayeeName,
              amount: orderTotal,
              note: 'Order ' + orderId,
              ref: orderId,
            }),
          );
          toast({
            type: 'success',
            title: t('checkout.orderPlaced', 'Order placed'),
            message: t(
              'pay.upiPlacedHint',
              'Complete the payment in your UPI app. The shop will confirm it before preparing your order.',
            ),
          });
        } catch {
          toast({
            type: 'error',
            title: t('pay.noUpiAppTitle', 'No UPI app found'),
            message: t('pay.noUpiApp', 'No UPI app found — pay to {vpa} manually', { vpa: shopVpa }),
          });
        }
        router.replace('/orders' as never);
        return;
      }
      toast({
        type: 'success',
        title: t('checkout.orderPlaced', 'Order placed'),
        message: t('checkout.orderPlacedHint', 'Your order has been sent to the shop.'),
      });
      router.replace('/orders' as never);
    } catch (e) {
      toast({
        type: 'error',
        title: t('checkout.orderFailed', 'Could not place order'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('common.checkout', 'Checkout') }} />

      {shop != null && !open ? (
        <Card style={{ backgroundColor: '#E5484D22' }}>
          <ThemedText type="smallBold" style={{ color: '#E5484D' }}>
            {t('common.shopClosed', 'The shop is not accepting orders right now.')}
          </ThemedText>
        </Card>
      ) : null}

      {invalidLines.length > 0 ? (
        <Card style={{ backgroundColor: '#E5484D22' }}>
          <ThemedText type="smallBold" style={{ color: '#E5484D' }}>
            {t('checkout.unavailableItems', 'Some items are no longer available:')}
          </ThemedText>
          {invalidLines.map((l) => (
            <ThemedText key={l.productId} type="small" style={{ color: '#E5484D' }}>
              {l.name}
            </ThemedText>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            {t('checkout.removeToPlace', 'Remove them to place your order.')}
          </ThemedText>
        </Card>
      ) : null}

      <SectionTitle>{t('checkout.yourCart', 'Your cart')}</SectionTitle>
      {cart.lines.length === 0 ? (
        <EmptyState
          title={t('checkout.cartEmpty', 'Cart is empty')}
          hint={t('checkout.cartEmptyHint', 'Add some products from the shop first.')}
        />
      ) : (
        <Card style={{ gap: Spacing.two }}>
          {cart.lines.map((l) => (
            <View key={l.productId} style={styles.cartItem}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small">{l.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {money(l.price)} × {l.qty} = {money(l.price * l.qty)}
                </ThemedText>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => cart.setQty(l.productId, l.qty - 1)}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  hitSlop={6}
                >
                  <ThemedText type="smallBold">−</ThemedText>
                </Pressable>
                <ThemedText type="smallBold" style={{ minWidth: 22, textAlign: 'center' }}>
                  {l.qty}
                </ThemedText>
                <Pressable
                  onPress={() => cart.setQty(l.productId, l.qty + 1)}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  hitSlop={6}
                >
                  <ThemedText type="smallBold">+</ThemedText>
                </Pressable>
              </View>
              <Pressable onPress={() => cart.remove(l.productId)} hitSlop={6} style={{ paddingLeft: Spacing.one }}>
                <ThemedText type="small" style={{ color: DANGER }}>✕</ThemedText>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => cart.clear()} style={{ alignSelf: 'flex-end' }} hitSlop={6}>
            <ThemedText type="small" style={{ color: DANGER }}>
              {t('checkout.clearCart', 'Clear cart')}
            </ThemedText>
          </Pressable>
        </Card>
      )}

      {cart.lines.length > 0 ? (
        <>
          <SectionTitle>{t('checkout.deliveryAddress', 'Delivery address')}</SectionTitle>
          {addresses.length > 0 ? (
            <Card>
              {addresses.map((a) => {
                const active = a.id === selectedAddressId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setSelectedAddressId(a.id)}
                    style={[
                      styles.addressRow,
                      { borderColor: active ? PRIMARY : theme.backgroundSelected },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      {a.label ? <ThemedText type="smallBold">{a.label}</ThemedText> : null}
                      <ThemedText type="small" themeColor="textSecondary">
                        {[a.door, a.street, a.city, a.pincode].filter(Boolean).join(', ')}
                      </ThemedText>
                    </View>
                    {active ? <Badge label={t('checkout.selected', 'Selected')} color={PRIMARY} /> : null}
                  </Pressable>
                );
              })}
              {selectedAddress ? (
                zoneLoading ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('checkout.checkingService', 'Checking serviceability…')}
                  </ThemedText>
                ) : !serviceable ? (
                  <ThemedText type="small" style={{ color: DANGER }}>
                    {t('checkout.notServing', 'Currently not serving this location')}
                  </ThemedText>
                ) : null
              ) : null}
            </Card>
          ) : null}

          {/* Inline add-address form: always shown when none exist, or on demand. */}
          {addresses.length === 0 || showAddressForm ? (
            <Card>
              <ThemedText type="smallBold">
                {t('checkout.addAddress', 'Add delivery address')}
              </ThemedText>
              <TextField
                label={t('checkout.addrDoor', 'Door / flat no.')}
                value={door}
                onChangeText={setDoor}
                placeholder={t('checkout.addrDoorPlaceholder', 'e.g. 12B')}
              />
              <TextField
                label={t('checkout.addrStreet', 'Street')}
                value={street}
                onChangeText={setStreet}
                placeholder={t('checkout.addrStreetPlaceholder', 'Street / area')}
              />
              <TextField
                label={t('checkout.addrCity', 'City')}
                value={city}
                onChangeText={setCity}
                placeholder={t('checkout.addrCityPlaceholder', 'City')}
              />
              <TextField
                label={t('checkout.addrPincode', 'Pincode')}
                value={pincode}
                onChangeText={setPincode}
                placeholder={t('checkout.addrPincodePlaceholder', '6-digit pincode')}
                keyboardType="number-pad"
              />
              <TextField
                label={t('checkout.addrLandmark', 'Landmark (optional)')}
                value={landmark}
                onChangeText={setLandmark}
                placeholder={t('checkout.addrLandmarkPlaceholder', 'Nearby landmark')}
              />
              <TextField
                label={t('checkout.addrLabel', 'Label (optional)')}
                value={label}
                onChangeText={setLabel}
                placeholder={t('checkout.addrLabelPlaceholder', 'e.g. Home, Work')}
              />
              <Button
                title={t('checkout.saveAddress', 'Save address')}
                onPress={saveNewAddress}
                loading={savingAddress}
              />
              {addresses.length > 0 ? (
                <Button
                  title={t('common.cancel', 'Cancel')}
                  variant="secondary"
                  onPress={() => setShowAddressForm(false)}
                />
              ) : null}
            </Card>
          ) : (
            <Button
              title={t('checkout.addAnotherAddress', 'Add another address')}
              variant="secondary"
              onPress={() => setShowAddressForm(true)}
            />
          )}

          <SectionTitle>{t('checkout.contact', 'Contact')}</SectionTitle>
          {savedPhone && isValidPhone(savedPhone) ? (
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                {t('checkout.contactAt', "We'll contact you at")}
              </ThemedText>
              <ThemedText type="smallBold">{customer?.phone}</ThemedText>
            </Card>
          ) : (
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                {t('checkout.addPhoneHint', 'The shop needs a phone number to reach you about your order.')}
              </ThemedText>
              <TextField
                label={t('common.phoneNumber', 'Phone number')}
                value={phoneInput}
                onChangeText={(v) => setPhoneInput(sanitizePhone(v))}
                placeholder={t('checkout.phonePlaceholder', '10-digit number')}
                keyboardType="phone-pad"
                maxLength={10}
              />
              {phoneInput.length > 0 && !isValidPhone(phoneInput) ? (
                <ThemedText type="small" style={{ color: DANGER }}>
                  {t('checkout.phoneInvalid', 'Enter a 10-digit phone number.')}
                </ThemedText>
              ) : null}
            </Card>
          )}

          <SectionTitle>{t('checkout.coupons', 'Coupons')}</SectionTitle>
          <Card>
            {defaultCoupons.length > 0 ? (
              <View style={styles.chipRow}>
                {defaultCoupons.map((c) => {
                  const active = appliedCoupon?.code === c.code;
                  return (
                    <Pressable
                      key={c.code}
                      onPress={() => applyChip(c)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? PRIMARY : theme.backgroundSelected,
                          borderColor: active ? PRIMARY : theme.backgroundSelected,
                        },
                      ]}
                    >
                      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                        {c.code}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.couponInputRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  value={couponCode}
                  onChangeText={setCouponCode}
                  placeholder={t('checkout.couponPlaceholder', 'Enter coupon code')}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
              <Button
                title={t('checkout.apply', 'Apply')}
                variant="secondary"
                onPress={() => applyCode(couponCode)}
                loading={applying}
                disabled={!couponCode.trim()}
              />
            </View>

            {couponError ? (
              <ThemedText type="small" style={{ color: DANGER }}>
                {couponError}
              </ThemedText>
            ) : null}

            {appliedCoupon && appliedRes ? (
              <View style={styles.lineRow}>
                <ThemedText type="small" style={{ color: SUCCESS, flex: 1 }}>
                  {t('checkout.couponApplied', 'Coupon {code} applied.', { code: appliedCoupon.code })}
                </ThemedText>
                <Pressable onPress={removeCoupon}>
                  <ThemedText type="small" style={{ color: DANGER }}>
                    {t('common.remove', 'Remove')}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </Card>

          <SectionTitle>{t('checkout.totals', 'Totals')}</SectionTitle>
          <Card>
            <View style={styles.lineRow}>
              <ThemedText type="small" style={{ flex: 1 }}>
                {t('checkout.subtotal', 'Subtotal')}
              </ThemedText>
              <ThemedText type="small">{money(subtotal)}</ThemedText>
            </View>
            {appliedCoupon && appliedRes ? (
              <View style={styles.lineRow}>
                <ThemedText type="small" style={{ flex: 1 }}>
                  {t('checkout.discount', 'Discount')}
                </ThemedText>
                <ThemedText type="small" style={{ color: SUCCESS }}>
                  −{money(appliedRes.discount)}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.lineRow}>
              <ThemedText type="small" style={{ flex: 1 }}>
                {t('checkout.delivery', 'Delivery')}
              </ThemedText>
              <ThemedText type="small">
                {appliedRes?.freeDelivery || effectiveDeliveryFee === 0 ? t('checkout.free', 'FREE') : money(effectiveDeliveryFee)}
              </ThemedText>
            </View>
            <View style={[styles.lineRow, styles.totalRow]}>
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {t('checkout.grandTotal', 'Grand total')}
              </ThemedText>
              <ThemedText type="smallBold">{money(grandTotal)}</ThemedText>
            </View>
          </Card>

          <SectionTitle>{t('pay.method', 'Payment method')}</SectionTitle>
          <Card>
            <View style={styles.chipRow}>
              {(['cod', 'upi'] as const).map((mode) => {
                const active = paymentMode === mode;
                const disabled = mode === 'upi' && !upiAvailable;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => !disabled && setPaymentMode(mode)}
                    disabled={disabled}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? PRIMARY : theme.backgroundSelected,
                        borderColor: active ? PRIMARY : theme.backgroundSelected,
                        opacity: disabled ? 0.5 : 1,
                      },
                    ]}
                  >
                    <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                      {mode === 'cod' ? t('pay.cod', 'Cash on delivery') : t('pay.upi', 'UPI')}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {!upiAvailable ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('pay.upiNotSetup', 'UPI not set up by the shop yet')}
              </ThemedText>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('checkout.note', 'Note')}</SectionTitle>
      <TextField
        label={t('checkout.noteLabel', 'Add a note for the shop (optional)')}
        value={note}
        onChangeText={setNote}
        placeholder={t('checkout.notePlaceholder', 'e.g. please pack separately')}
        multiline
      />

      {/* Phone OTP verification disabled for now (kept for later)
      <SectionTitle>{t('checkout.phoneVerification', 'Phone verification (optional)')}</SectionTitle>
      <Card>
        {verified ? (
          <Badge label={t('checkout.phoneVerified', 'Phone verified')} color={SUCCESS} />
        ) : (
          <>
            <TextField
              label={t('common.phoneNumber', 'Phone number')}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('checkout.phonePlaceholder', '10-digit number')}
              keyboardType="phone-pad"
              editable={!otpSent}
            />
            <Button title={t('checkout.sendOtp', 'Send OTP')} variant="secondary" onPress={sendOtp} loading={sending} disabled={!phone.trim()} />
            {otpSent ? (
              <>
                <TextField
                  label={t('checkout.enterCode', 'Enter code')}
                  value={code}
                  onChangeText={setCode}
                  placeholder={t('checkout.codePlaceholder', '6-digit code')}
                  keyboardType="number-pad"
                />
                <Button title={t('checkout.verify', 'Verify')} onPress={verifyOtp} loading={verifying} disabled={!code.trim()} />
              </>
            ) : null}
          </>
        )}
      </Card>
      */}

      <Button
        title={
          paymentMode === 'upi'
            ? t('pay.openUpiPay', 'Open UPI app to pay')
            : t('checkout.placeOrder', 'Place order')
        }
        onPress={onPlaceOrder}
        loading={placing}
        disabled={
          shop == null ||
          !open ||
          cart.lines.length === 0 ||
          invalidLines.length > 0 ||
          !selectedAddress ||
          !serviceable ||
          !hasPhone
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  totalRow: { marginTop: Spacing.two },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
  couponInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  cartItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: {
    borderWidth: 1,
    borderRadius: 8,
    minWidth: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
