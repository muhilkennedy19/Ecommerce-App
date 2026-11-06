import {
  DEFAULT_OPERATING_HOURS,
  deleteZone,
  shopAcceptsOrders,
  subscribeDeliveryZones,
  subscribeShop,
  updateShop,
  upsertZone,
  userHasPermission,
  type DeliveryZone,
  type OperatingHours,
  type Shop,
  type Weekday,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Screen, SectionTitle, SUCCESS, SwitchRow, TextField } from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

const WEEKDAYS: { key: Weekday; labelKey: string; label: string }[] = [
  { key: 'sun', labelKey: 'settings.weekday.sun', label: 'Sunday' },
  { key: 'mon', labelKey: 'settings.weekday.mon', label: 'Monday' },
  { key: 'tue', labelKey: 'settings.weekday.tue', label: 'Tuesday' },
  { key: 'wed', labelKey: 'settings.weekday.wed', label: 'Wednesday' },
  { key: 'thu', labelKey: 'settings.weekday.thu', label: 'Thursday' },
  { key: 'fri', labelKey: 'settings.weekday.fri', label: 'Friday' },
  { key: 'sat', labelKey: 'settings.weekday.sat', label: 'Saturday' },
];

/** Pad a loosely-typed time (e.g. "9:00") to "HH:MM" so valid input isn't rejected. */
function normalizeTime(time: string): string {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : time.trim();
}

/**
 * Store configuration: when the shop is open (operating hours + force-close), subscription
 * minimum, and delivery areas. Split out of the old monolithic Settings screen. Super-user +
 * admin only (`shop.config`).
 */
export default function StoreConfig() {
  const appUser = useAuth().appUser;
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const canConfig = userHasPermission(appUser, 'shop.config');

  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const initRef = useRef(false);

  const [subMin, setSubMin] = useState('');
  const [savingSubMin, setSavingSubMin] = useState(false);

  const [hours, setHours] = useState<OperatingHours>(DEFAULT_OPERATING_HOURS);
  const [forceClosed, setForceClosed] = useState(false);
  const [savingHours, setSavingHours] = useState(false);

  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [zonePincode, setZonePincode] = useState('');
  const [zoneFee, setZoneFee] = useState('');
  const [zoneFreeAbove, setZoneFreeAbove] = useState('');
  const [zoneServiceable, setZoneServiceable] = useState(true);
  const [savingZone, setSavingZone] = useState(false);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeShop(shopId, (s) => {
      setShop(s);
      setLoaded(true);
      if (s && !initRef.current) {
        initRef.current = true;
        setSubMin(s.subscriptionMinOrder ? String(s.subscriptionMinOrder) : '');
        setHours(s.operatingHours ?? DEFAULT_OPERATING_HOURS);
        setForceClosed(!!s.forceClosed);
      }
    });
  }, [canConfig]);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeDeliveryZones(setZones);
  }, [canConfig]);

  function setDay(key: Weekday, patch: Partial<OperatingHours['days'][Weekday]>) {
    setHours((h) => ({ ...h, days: { ...h.days, [key]: { ...h.days[key], ...patch } } }));
  }

  async function saveSubMin() {
    setSavingSubMin(true);
    try {
      const n = subMin.trim() ? Math.max(0, Math.round(Number(subMin) || 0)) : 0;
      await updateShop(shopId, { subscriptionMinOrder: n || null });
      toast({
        type: 'success',
        title: t('common.saved', 'Saved') + ' ✓',
        message: t('subscribe.minUpdated', 'Subscription minimum updated.'),
      });
    } catch (e) {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: String(e) });
    } finally {
      setSavingSubMin(false);
    }
  }

  async function saveHours() {
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const normalized: OperatingHours = { ...hours, days: { ...hours.days } };
    for (const { key } of WEEKDAYS) {
      const d = hours.days[key];
      normalized.days[key] = { ...d, open: normalizeTime(d.open), close: normalizeTime(d.close) };
    }
    for (const { key, labelKey, label } of WEEKDAYS) {
      const day = normalized.days[key];
      if (day.closed) continue;
      const dayLabel = t(labelKey, label);
      if (!timeRe.test(day.open)) {
        toast({ type: 'error', title: t('settings.invalidHours', 'Invalid hours'), message: t('settings.invalidOpen', '{label}: enter a valid open time as HH:MM.', { label: dayLabel }) });
        return;
      }
      if (!timeRe.test(day.close)) {
        toast({ type: 'error', title: t('settings.invalidHours', 'Invalid hours'), message: t('settings.invalidClose', '{label}: enter a valid close time as HH:MM.', { label: dayLabel }) });
        return;
      }
    }
    setHours(normalized);
    setSavingHours(true);
    try {
      await updateShop(shopId, { operatingHours: normalized });
      toast({ type: 'success', title: t('common.saved', 'Saved') + ' ✓', message: t('settings.hoursUpdated', 'Operating hours updated.') });
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotSaveHours', 'Could not save hours'), message: String(e) });
    } finally {
      setSavingHours(false);
    }
  }

  async function saveForceClosed(v: boolean) {
    setForceClosed(v); // optimistic
    try {
      await updateShop(shopId, { forceClosed: v });
    } catch (e) {
      setForceClosed(!v); // revert on failure
      toast({ type: 'error', title: t('settings.couldNotUpdate', 'Could not update'), message: String(e) });
    }
  }

  async function saveZone() {
    const pincode = zonePincode.trim();
    if (!pincode) {
      toast({ type: 'error', title: t('settings.missingPincode', 'Missing pincode'), message: t('settings.missingPincodeHint', 'Enter a pincode for this delivery area.') });
      return;
    }
    setSavingZone(true);
    try {
      await upsertZone({
        pincode,
        deliveryFee: Number(zoneFee) || 0,
        freeAbove: Number(zoneFreeAbove) || 0,
        serviceable: zoneServiceable,
      });
      setZonePincode('');
      setZoneFee('');
      setZoneFreeAbove('');
      setZoneServiceable(true);
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotSaveArea', 'Could not save area'), message: String(e) });
    } finally {
      setSavingZone(false);
    }
  }

  async function confirmDeleteZone(pincode: string) {
    const ok = await confirm({
      title: t('settings.deleteArea', 'Delete area'),
      message: t('settings.deleteAreaConfirm', 'Remove delivery area {pincode}?', { pincode }),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteZone(pincode);
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotDelete', 'Could not delete'), message: String(e) });
    }
  }

  if (!canConfig) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('settings.storeConfig', 'Store configuration') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('settings.noAccessHint', "Your role can't configure the shop. Ask an admin if you need it.")}
        />
      </Screen>
    );
  }

  if (!loaded) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Stack.Screen options={{ title: t('settings.storeConfig', 'Store configuration') }} />
        <ActivityIndicator />
      </Screen>
    );
  }

  const open = shop ? shopAcceptsOrders(shop) : false;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.storeConfig', 'Store configuration') }} />

      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ThemedText type="smallBold">{t('settings.statusNow', 'Status right now')}</ThemedText>
        <Badge label={open ? t('settings.open', 'Open') : t('settings.closed', 'Closed')} color={open ? SUCCESS : DANGER} />
      </Card>

      <Card>
        <SwitchRow
          label={t('settings.forceClose', 'Force close (override schedule)')}
          value={forceClosed}
          onValueChange={(v) => void saveForceClosed(v)}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.forceCloseHint', 'When on, the shop stays closed to buyers regardless of the operating hours below.')}
        </ThemedText>
      </Card>

      <SectionTitle>{t('subscribe.section', 'Subscriptions')}</SectionTitle>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'subscribe.minNote',
            'Minimum cart total (₹) a buyer needs to start a subscription. Subscription orders are delivered free. Leave 0 to disable subscriptions.',
          )}
        </ThemedText>
        <TextField
          label={t('subscribe.minLabel', 'Minimum order (₹)')}
          value={subMin}
          onChangeText={setSubMin}
          keyboardType="numeric"
          placeholder="0"
        />
        <Button title={t('subscribe.saveMin', 'Save minimum')} loading={savingSubMin} onPress={() => void saveSubMin()} />
      </Card>

      <SectionTitle>{t('settings.hours', 'Operating hours')}</SectionTitle>
      <Card>
        {WEEKDAYS.map(({ key, labelKey, label }) => {
          const day = hours.days[key];
          return (
            <View key={key} style={{ gap: Spacing.one }}>
              <SwitchRow
                label={t('settings.dayOpen', '{label} — Open', { label: t(labelKey, label) })}
                value={!day.closed}
                onValueChange={(v) => setDay(key, { closed: !v })}
              />
              {!day.closed ? (
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={t('settings.openTime', 'Open (HH:MM)')}
                      value={day.open}
                      onChangeText={(time) => setDay(key, { open: time })}
                      placeholder="09:00"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={t('settings.closeTime', 'Close (HH:MM)')}
                      value={day.close}
                      onChangeText={(time) => setDay(key, { close: time })}
                      placeholder="18:00"
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        <Button title={t('settings.saveHours', 'Save hours')} loading={savingHours} onPress={() => void saveHours()} />
      </Card>

      <SectionTitle>{t('settings.deliveryAreas', 'Delivery areas')}</SectionTitle>
      {zones.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.noAreas', 'No delivery areas yet. Add a pincode below.')}
          </ThemedText>
        </Card>
      ) : (
        zones.map((z) => (
          <Card key={z.pincode} style={{ gap: Spacing.two }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">{z.pincode}</ThemedText>
              <Badge
                label={z.serviceable ? t('settings.serviceable', 'Serviceable') : t('settings.notServiceable', 'Not serviceable')}
                color={z.serviceable ? SUCCESS : DANGER}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('settings.feeFreeAbove', '₹{fee}, free above ₹{free}', { fee: z.deliveryFee, free: z.freeAbove })}
            </ThemedText>
            <Button title={t('common.delete', 'Delete')} variant="danger" onPress={() => confirmDeleteZone(z.pincode)} />
          </Card>
        ))
      )}
      <Card>
        <TextField
          label={t('settings.pincode', 'Pincode')}
          value={zonePincode}
          onChangeText={setZonePincode}
          placeholder="560001"
          keyboardType="numeric"
        />
        <TextField
          label={t('settings.deliveryFee', 'Delivery fee (₹)')}
          value={zoneFee}
          onChangeText={setZoneFee}
          placeholder="0"
          keyboardType="numeric"
        />
        <TextField
          label={t('settings.freeAbove', 'Free above (₹)')}
          value={zoneFreeAbove}
          onChangeText={setZoneFreeAbove}
          placeholder="0"
          keyboardType="numeric"
        />
        <SwitchRow label={t('settings.serviceable', 'Serviceable')} value={zoneServiceable} onValueChange={setZoneServiceable} />
        <Button
          title={t('settings.addUpdateArea', 'Add / update area')}
          loading={savingZone}
          disabled={!zonePincode.trim()}
          onPress={() => void saveZone()}
        />
      </Card>
    </Screen>
  );
}
