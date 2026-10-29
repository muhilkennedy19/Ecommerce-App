import {
  deliveryFeeFor,
  evaluateCoupon,
  formatQty,
  getCoupon,
  getCustomer,
  getIdToken,
  getZone,
  buildUpiUrl,
  isDivisibleUnit,
  isValidPhone,
  qtyToSubUnits,
  sanitizePhone,
  saveAddresses,
  setCustomerPhone,
  shopAcceptsOrders,
  subUnitOf,
  subUnitsToQty,
  SUB_UNIT_STEP,
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
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useToast } from '@/components/feedback';
import { CartSubscribe } from '@/components/cart-subscribe';
import { LocationPicker, type LatLng } from '@/components/location-picker';
import { Badge, Button, Card, DANGER, EmptyState, PRIMARY, Screen, SectionTitle, SUCCESS, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCart, type CartLine } from '@/lib/cart';
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
  // Set once a UPI order is placed: swaps the form for an in-app payment panel
  // (VPA + copy + retry) so a UPI-app refusal never strands the buyer.
  const [upiPay, setUpiPay] = useState<{ orderId: string; amount: number } | null>(null);

  // Payment
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cod');

  // Inline "add delivery address" form.
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  // Delivery pin for the add-address form, and per-address pin edits made at checkout.
  const [newAddrCoords, setNewAddrCoords] = useState<LatLng | null>(null);
  const [coordEdits, setCoordEdits] = useState<Record<string, LatLng>>({});
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
        // Seed the editable field so a saved number can be corrected in place.
        const saved = c?.phone?.trim();
        if (saved) setPhoneInput(saved);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const addresses = customer?.addresses ?? [];
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null;
  // Effective delivery pin for the selected address: a checkout-time edit wins, else the
  // coordinates saved on the address (if any). No effect/setState-on-select needed.
  const selectedCoords: LatLng | null = selectedAddress
    ? (coordEdits[selectedAddress.id] ??
      (selectedAddress.lat != null && selectedAddress.lng != null
        ? { lat: selectedAddress.lat, lng: selectedAddress.lng }
        : null))
    : null;
  const savedPhone = customer?.phone?.trim() ?? '';
  // The field is editable and seeded from the saved number, so what is typed wins.
  const effectivePhone = phoneInput.trim() || savedPhone;
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
      lat: newAddrCoords?.lat ?? null,
      lng: newAddrCoords?.lng ?? null,
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
      setNewAddrCoords(null);
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

  const copyVpa = async () => {
    await Clipboard.setStringAsync(shopVpa);
    toast({
      type: 'success',
      title: t('pay.copied', 'Copied'),
      message: t('pay.copiedHint', 'UPI ID copied — paste it in your UPI app.'),
    });
  };

  // Fire the UPI deep link. Kept as a plain P2P intent (no `tr`) so apps like GPay
  // don't route a personal payee through the merchant path (see common/util/payment).
  const openUpiApp = async (orderId: string, amount: number) => {
    try {
      await Linking.openURL(
        buildUpiUrl({ vpa: shopVpa, payeeName: shop?.upiPayeeName, amount, note: 'Order ' + orderId }),
      );
    } catch {
      toast({
        type: 'error',
        title: t('pay.noUpiAppTitle', 'No UPI app found'),
        message: t('pay.noUpiApp', 'No UPI app found — pay to {vpa} manually', { vpa: shopVpa }),
      });
    }
  };

  const onPlaceOrder = async () => {
    if (!user || !selectedAddress || !hasPhone) return;
    const email = user.email ?? '';
    setPlacing(true);
    try {
      // Snapshot the confirmed delivery pin onto the order's address so the seller can
      // navigate to the exact spot. Fire-and-forget persist it back to the saved address too.
      const addressForOrder: Address = {
        ...selectedAddress,
        lat: selectedCoords?.lat ?? selectedAddress.lat ?? null,
        lng: selectedCoords?.lng ?? selectedAddress.lng ?? null,
      };
      if (
        selectedCoords &&
        (selectedCoords.lat !== selectedAddress.lat || selectedCoords.lng !== selectedAddress.lng)
      ) {
        const next = (customer?.addresses ?? []).map((a) =>
          a.id === selectedAddress.id ? addressForOrder : a,
        );
        void saveAddresses(user.uid, next, customer?.defaultAddressId ?? selectedAddress.id).catch(
          () => {},
        );
      }
      const items: OrderItem[] = cart.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        price: l.price,
        qty: l.qty,
        unit: l.unit ?? null,
      }));
      const orderId = await placeOrder({
        shopId,
        customerId: user.uid,
        customerName: user.displayName ?? email,
        items,
        note: note.trim() || null,
        address: addressForOrder,
        pincode: selectedAddress.pincode,
        deliveryFee: appliedRes ? appliedRes.deliveryFee : deliveryFee,
        couponCode: appliedCoupon?.code ?? null,
        discount: appliedRes?.discount ?? 0,
        customerPhone: effectivePhone,
        paymentMode,
      });
      // Persist the number whenever it differs from what's on the customer doc —
      // the field is editable, so this also saves corrections to an existing one.
      const typedPhone = phoneInput.trim();
      if (typedPhone && typedPhone !== savedPhone) {
        await setCustomerPhone(user.uid, typedPhone);
      }
      const orderTotal = grandTotal;
      cart.clear();
      // Fire-and-forget: notify the shop of the new order (graceful no-op if push unconfigured).
      void getIdToken().then((idToken) =>
        sendNotify(notifyUrl, idToken, { event: 'new-order', shopId, orderId }),
      );
      if (paymentMode === 'upi') {
        // Order is placed. Show the in-app payment panel and open the UPI app. We stay on
        // this screen (no redirect) so a UPI-app refusal doesn't strand the buyer — they can
        // copy the UPI ID and pay manually, then tap "I've paid".
        setUpiPay({ orderId, amount: orderTotal });
        await openUpiApp(orderId, orderTotal);
        toast({
          type: 'success',
          title: t('checkout.orderPlaced', 'Order placed'),
          message: t(
            'pay.upiPlacedHint',
            'Complete the payment in your UPI app. The shop will confirm it before preparing your order.',
          ),
        });
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

  // Post-placement UPI payment panel: shown after a UPI order is placed. Gives the buyer
  // the amount, the shop's UPI ID with a Copy button, a retry button, and a manual-pay
  // hint — so even if the UPI app refuses the deep link, they can still pay.
  if (upiPay) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('pay.complete', 'Complete payment') }} />
        <Card style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t('checkout.orderPlaced', 'Order placed')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(
              'pay.upiPlacedHint',
              'Complete the payment in your UPI app. The shop will confirm it before preparing your order.',
            )}
          </ThemedText>
        </Card>

        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('pay.amountLabel', 'Amount')}
          </ThemedText>
          <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
            {money(upiPay.amount)}
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            {t('pay.vpaLabel', 'UPI ID')}
          </ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {shopVpa}
            </ThemedText>
            <Button title={t('pay.copy', 'Copy')} variant="secondary" onPress={() => void copyVpa()} />
          </View>
          {shop?.upiPayeeName ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('pay.payeeLabel', 'Payee: {name}', { name: shop.upiPayeeName })}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {t('pay.refLabel', 'Reference: Order {id}', { id: upiPay.orderId.slice(0, 6) })}
          </ThemedText>
        </Card>

        <Button
          title={t('pay.openUpiPay', 'Open UPI app to pay')}
          onPress={() => void openUpiApp(upiPay.orderId, upiPay.amount)}
        />
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {t(
            'pay.manualHint',
            'If your UPI app shows an error, copy the UPI ID above and pay manually in any UPI app, then come back.',
          )}
        </ThemedText>
        <Button
          title={t('pay.paid', "I've paid")}
          variant="secondary"
          onPress={() => router.replace('/orders' as never)}
        />
      </Screen>
    );
  }

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
            <CartLineRow key={l.productId} line={l} />
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
              <ThemedText type="small" themeColor="textSecondary">
                {t('checkout.deliveryLocation', 'Delivery location')}
              </ThemedText>
              <LocationPicker value={newAddrCoords} onChange={setNewAddrCoords} />
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

          {selectedAddress && !showAddressForm ? (
            <>
              <SectionTitle>{t('checkout.deliveryLocation', 'Delivery location')}</SectionTitle>
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('checkout.confirmLocationHint', 'Confirm the exact drop point so the rider can find you.')}
                </ThemedText>
                <LocationPicker
                  value={selectedCoords}
                  onChange={(c) => setCoordEdits((m) => ({ ...m, [selectedAddress.id]: c }))}
                />
                {!selectedCoords ? (
                  <ThemedText type="small" style={{ color: DANGER }}>
                    {t('checkout.noPinWarn', 'No delivery pin yet — drop one for accurate delivery.')}
                  </ThemedText>
                ) : null}
              </Card>
            </>
          ) : null}

          <SectionTitle>{t('checkout.contact', 'Contact')}</SectionTitle>
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
            {/* Required field: surface why Place order stays disabled. */}
            {phoneInput.trim().length === 0 ? (
              <ThemedText type="small" style={{ color: DANGER }}>
                {t('checkout.phoneRequired', 'Phone number is required to place an order.')}
              </ThemedText>
            ) : !isValidPhone(phoneInput) ? (
              <ThemedText type="small" style={{ color: DANGER }}>
                {t('checkout.phoneInvalid', 'Enter a 10-digit phone number.')}
              </ThemedText>
            ) : null}
          </Card>

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

      <CartSubscribe
        items={cart.lines.map((l) => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty, unit: l.unit ?? null }))}
        subtotal={subtotal}
        minOrder={shop?.subscriptionMinOrder ?? 0}
        address={
          selectedAddress
            ? {
                ...selectedAddress,
                lat: selectedCoords?.lat ?? selectedAddress.lat ?? null,
                lng: selectedCoords?.lng ?? selectedAddress.lng ?? null,
              }
            : null
        }
        user={user}
        customer={customer}
        onCreated={() => {
          cart.clear();
          router.replace('/subscriptions');
        }}
      />

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

/**
 * One cart line. Countable items get a whole-number stepper; items priced per Kg
 * or Litre get a sub-unit stepper plus a free-text box, so 300 g or 1200 g of a
 * ₹/Kg product can be ordered and priced pro-rata.
 */
function CartLineRow({ line }: Readonly<{ line: CartLine }>) {
  const cart = useCart();
  const theme = useTheme();
  const t = useT();
  const divisible = isDivisibleUnit(line.unit);
  const sub = subUnitOf(line.unit);
  const step = divisible ? SUB_UNIT_STEP : 1;

  // Sub-unit amount (grams) for divisible items, plain count otherwise.
  const amount = divisible ? qtyToSubUnits(line.qty, line.unit) : line.qty;

  // `draft` is only set while the field is being edited, so the displayed value
  // follows the +/- buttons without an effect mirroring state back and forth.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(amount);

  const applyAmount = (next: number) => {
    const safe = Math.max(0, next);
    cart.setQty(line.productId, divisible ? subUnitsToQty(safe, line.unit) : safe);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null); // always fall back to the canonical value
    if (!Number.isFinite(parsed) || parsed <= 0) return; // reject junk, snap back
    applyAmount(divisible ? Math.round(parsed) : Math.max(1, Math.round(parsed)));
  };

  const lineTotal = line.price * line.qty;

  return (
    <View style={styles.cartLine}>
      <View style={styles.cartItem}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small">{line.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {money(line.price)}
            {line.unit ? `/${formatQty(1, line.unit).replace('1 ', '')}` : ''} ×{' '}
            {formatQty(line.qty, line.unit)} = {money(lineTotal)}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => cart.remove(line.productId)}
          hitSlop={6}
          style={{ paddingLeft: Spacing.one }}
        >
          <ThemedText type="small" style={{ color: DANGER }}>
            ✕
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.stepper}>
        <Pressable
          onPress={() => applyAmount(amount - step)}
          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
          hitSlop={6}
        >
          <ThemedText type="smallBold">−</ThemedText>
        </Pressable>

        {divisible ? (
          <View style={styles.qtyInputWrap}>
            <TextInput
              value={shown}
              onChangeText={setDraft}
              onBlur={commitDraft}
              onSubmitEditing={commitDraft}
              keyboardType="numeric"
              returnKeyType="done"
              selectTextOnFocus
              style={[
                styles.qtyInput,
                { color: theme.text, borderColor: theme.backgroundSelected },
              ]}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {sub?.label}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="smallBold" style={{ minWidth: 22, textAlign: 'center' }}>
            {line.qty}
          </ThemedText>
        )}

        <Pressable
          onPress={() => applyAmount(amount + step)}
          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
          hitSlop={6}
        >
          <ThemedText type="smallBold">+</ThemedText>
        </Pressable>

        {divisible ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ flexShrink: 1 }}>
            {t('checkout.qtyHint', 'tap to type an exact amount')}
          </ThemedText>
        ) : null}
      </View>
    </View>
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
  cartLine: { gap: Spacing.one, paddingVertical: Spacing.one },
  qtyInputWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    minWidth: 62,
    textAlign: 'center',
    fontWeight: '700',
  },
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
