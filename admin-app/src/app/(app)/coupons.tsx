import {
  deleteCoupon,
  userHasPermission,
  subscribeCoupons,
  upsertCoupon,
  type Coupon,
  type CouponDiscountType,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  PRIMARY,
  Screen,
  SectionTitle,
  SUCCESS,
  SwitchRow,
  TextField,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT, type TFn } from '@/lib/i18n';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const DISCOUNT_TYPES: { key: CouponDiscountType; labelKey: string; label: string }[] = [
  { key: 'flat', labelKey: 'coupons.typeFlat', label: 'Flat ₹ off' },
  { key: 'percent', labelKey: 'coupons.typePercent', label: '% off' },
  { key: 'none', labelKey: 'coupons.typeNone', label: 'Free delivery only' },
];

/** Human-readable one-line summary of what a coupon does. */
function summarize(c: Coupon, t: TFn): string {
  const parts: string[] = [];
  if (c.discountType === 'percent') {
    parts.push(
      c.maxDiscount
        ? t('coupons.sumPercentCap', '{value}% off up to ₹{max}', { value: c.value, max: c.maxDiscount })
        : t('coupons.sumPercent', '{value}% off', { value: c.value }),
    );
  } else if (c.discountType === 'flat') {
    parts.push(t('coupons.sumFlat', '₹{value} off', { value: c.value }));
  }
  if (c.freeDelivery || c.discountType === 'none') parts.push(t('coupons.freeDelivery', 'Free delivery'));
  if (parts.length === 0) parts.push(t('coupons.noDiscount', 'No discount'));
  return parts.join(' · ');
}

function TypePills({
  selected,
  onSelect,
}: Readonly<{
  selected: CouponDiscountType;
  onSelect: (t: CouponDiscountType) => void;
}>) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={styles.pills}>
      {DISCOUNT_TYPES.map(({ key, labelKey, label }) => {
        const active = selected === key;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: active ? PRIMARY : theme.backgroundSelected,
                backgroundColor: active ? PRIMARY + '22' : 'transparent',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <ThemedText type="small" style={active ? { color: PRIMARY } : undefined}>
              {t(labelKey, label)}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function CouponsScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = userHasPermission(appUser, 'sales.discount');

  const [coupons, setCoupons] = useState<Coupon[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType>('flat');
  const [value, setValue] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [freeDelivery, setFreeDelivery] = useState(false);
  const [active, setActive] = useState(true);
  const [showByDefault, setShowByDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    const unsub = subscribeCoupons(shopId, setCoupons);
    return () => unsub();
  }, [canManage]);

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('coupons.title', 'Coupons') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('coupons.noAccessHint', "Your role can't manage coupons.")} />
      </Screen>
    );
  }

  function resetForm() {
    setShowForm(false);
    setCode('');
    setDiscountType('flat');
    setValue('');
    setMaxDiscount('');
    setMinOrder('');
    setFreeDelivery(false);
    setActive(true);
    setShowByDefault(false);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(c: Coupon) {
    setCode(c.code);
    setDiscountType(c.discountType);
    setValue(c.value ? String(c.value) : '');
    setMaxDiscount(c.maxDiscount != null ? String(c.maxDiscount) : '');
    setMinOrder(c.minOrder != null ? String(c.minOrder) : '');
    setFreeDelivery(!!c.freeDelivery);
    setActive(c.active);
    setShowByDefault(!!c.showByDefault);
    setShowForm(true);
  }

  async function onSave() {
    const trimmedCode = code.trim().toUpperCase();
    const isPercent = discountType === 'percent';
    const isFlat = discountType === 'flat';
    const valueNum = Number(value) || 0;

    if (!trimmedCode) {
      toast({ type: 'error', title: t('coupons.missingCode', 'Missing code'), message: t('coupons.missingCodeHint', 'Please enter a coupon code.') });
      return;
    }
    if ((isFlat || isPercent) && !(valueNum > 0)) {
      toast({ type: 'error', title: t('coupons.invalidValue', 'Invalid value'), message: t('coupons.invalidValueHint', 'Enter a discount value greater than 0.') });
      return;
    }
    if (isPercent && valueNum > 100) {
      toast({ type: 'error', title: t('coupons.invalidPercent', 'Invalid percentage'), message: t('coupons.invalidPercentHint', 'A percentage discount can be at most 100%.') });
      return;
    }

    setSaving(true);
    try {
      await upsertCoupon({
        code: trimmedCode,
        shopId,
        discountType,
        value: valueNum,
        maxDiscount: isPercent && maxDiscount ? Number(maxDiscount) : null,
        minOrder: minOrder ? Number(minOrder) : null,
        freeDelivery,
        active,
        showByDefault,
      });
      resetForm();
    } catch (e) {
      toast({ type: 'error', title: t('common.saveFailed', 'Save failed'), message: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(c: Coupon) {
    const ok = await confirm({
      title: t('coupons.deleteCoupon', 'Delete coupon'),
      message: t('coupons.deleteConfirm', 'Delete "{code}"? This can\'t be undone.', { code: c.code }),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCoupon(c.code);
    } catch (e) {
      toast({ type: 'error', title: t('coupons.deleteFailed', 'Delete failed'), message: errMsg(e) });
    }
  }

  const showValueField = discountType === 'flat' || discountType === 'percent';

  return (
    <Screen>
      <Stack.Screen options={{ title: t('coupons.title', 'Coupons') }} />

      {showForm ? (
        <>
          <SectionTitle>{code.trim() ? t('coupons.edit', 'Edit coupon') : t('coupons.new', 'New coupon')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            <TextField
              label={t('coupons.code', 'Code')}
              placeholder="SAVE20"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <ThemedText type="small" themeColor="textSecondary">
              {t('coupons.discountType', 'Discount type')}
            </ThemedText>
            <TypePills selected={discountType} onSelect={setDiscountType} />

            {showValueField ? (
              <TextField
                label={discountType === 'flat' ? t('coupons.amountOff', 'Amount off (₹)') : t('coupons.percentOff', 'Percentage off (%)')}
                placeholder="0"
                value={value}
                onChangeText={setValue}
                keyboardType="numeric"
              />
            ) : null}

            {discountType === 'percent' ? (
              <TextField
                label={t('coupons.maxCap', 'Max ₹ cap (optional)')}
                placeholder="0"
                value={maxDiscount}
                onChangeText={setMaxDiscount}
                keyboardType="numeric"
              />
            ) : null}

            <TextField
              label={t('coupons.minOrder', 'Minimum order ₹ (optional)')}
              placeholder="0"
              value={minOrder}
              onChangeText={setMinOrder}
              keyboardType="numeric"
            />

            <SwitchRow label={t('coupons.freeDelivery', 'Free delivery')} value={freeDelivery} onValueChange={setFreeDelivery} />
            <SwitchRow label={t('coupons.activeSwitch', 'Active')} value={active} onValueChange={setActive} />
            <SwitchRow
              label={t('coupons.showAll', 'Show to all customers at checkout')}
              value={showByDefault}
              onValueChange={setShowByDefault}
            />

            <Button title={t('coupons.saveCoupon', 'Save coupon')} loading={saving} onPress={() => void onSave()} />
            <Button title={t('common.cancel', 'Cancel')} variant="secondary" onPress={resetForm} />
          </Card>
        </>
      ) : (
        <Button title={t('coupons.add', 'Add coupon')} onPress={openCreate} />
      )}

      <SectionTitle>{t('coupons.heading', 'Coupons')}</SectionTitle>
      {coupons.length === 0 ? (
        <EmptyState title={t('coupons.noneTitle', 'No coupons yet')} hint={t('coupons.noneHint', 'Add a coupon to offer discounts or free delivery.')} />
      ) : (
        coupons.map((c) => (
          <Card key={c.code} style={{ gap: Spacing.two }}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{c.code}</ThemedText>
              <View style={styles.badges}>
                <Badge label={c.active ? t('coupons.active', 'Active') : t('coupons.inactive', 'Inactive')} color={c.active ? SUCCESS : DANGER} />
                {c.showByDefault ? <Badge label={t('coupons.shownToAll', 'Shown to all')} /> : null}
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {summarize(c, t)}
              {c.minOrder ? t('coupons.minSuffix', ' · min ₹{min}', { min: c.minOrder }) : ''}
            </ThemedText>
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button title={t('common.edit', 'Edit')} variant="secondary" onPress={() => openEdit(c)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('common.delete', 'Delete')} variant="danger" onPress={() => onDelete(c)} />
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
