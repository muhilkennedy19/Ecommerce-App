import {
  DEFAULT_OPERATING_HOURS,
  deleteZone,
  getFast2SmsKey,
  setFast2SmsKey,
  shopAcceptsOrders,
  subscribeDeliveryZones,
  subscribeShop,
  updateShop,
  upsertZone,
  userHasPermission,
  userHasRole,
  type DeliveryZone,
  type OperatingHours,
  type Shop,
  type Weekday,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  Screen,
  SectionTitle,
  SUCCESS,
  SwitchRow,
  TextField,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { LOCALES, useI18n } from '@/lib/i18n';

const WEEKDAYS: { key: Weekday; labelKey: string; label: string }[] = [
  { key: 'sun', labelKey: 'settings.weekday.sun', label: 'Sunday' },
  { key: 'mon', labelKey: 'settings.weekday.mon', label: 'Monday' },
  { key: 'tue', labelKey: 'settings.weekday.tue', label: 'Tuesday' },
  { key: 'wed', labelKey: 'settings.weekday.wed', label: 'Wednesday' },
  { key: 'thu', labelKey: 'settings.weekday.thu', label: 'Thursday' },
  { key: 'fri', labelKey: 'settings.weekday.fri', label: 'Friday' },
  { key: 'sat', labelKey: 'settings.weekday.sat', label: 'Saturday' },
];

function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

/** Pad a loosely-typed time (e.g. "9:00") to "HH:MM" so valid input isn't rejected. */
function normalizeTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : t.trim();
}

export default function Settings() {
  const appUser = useAuth().appUser;
  const { t, locale, setLocale } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const canConfig = userHasPermission(appUser, 'shop.config');
  // Fast2SMS key is a shared secret — restrict it to the superuser only.
  const canSecrets = userHasRole(appUser, 'superuser');

  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const initRef = useRef(false); // populate the form from the shop doc only once

  const [name, setName] = useState('');
  const [hours, setHours] = useState<OperatingHours>(DEFAULT_OPERATING_HOURS);
  const [forceClosed, setForceClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [upiVpa, setUpiVpa] = useState('');
  const [upiPayee, setUpiPayee] = useState('');
  const [savingUpi, setSavingUpi] = useState(false);

  const [fast2sms, setFast2sms] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);

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
        setName(s.name);
        setHours(s.operatingHours ?? DEFAULT_OPERATING_HOURS);
        setForceClosed(!!s.forceClosed);
        setUpiVpa(s.upiVpa ?? '');
        setUpiPayee(s.upiPayeeName ?? '');
      }
    });
  }, [canConfig]);

  useEffect(() => {
    if (!canSecrets) return;
    void getFast2SmsKey().then(setFast2sms);
  }, [canSecrets]);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeDeliveryZones(setZones);
  }, [canConfig]);

  function setDay(key: Weekday, patch: Partial<OperatingHours['days'][Weekday]>) {
    setHours((h) => ({ ...h, days: { ...h.days, [key]: { ...h.days[key], ...patch } } }));
  }

  async function createShop() {
    setSaving(true);
    try {
      await updateShop(shopId, {
        name: name.trim() || 'My Shop',
        salesDiscountPercent: 0,
        operatingHours: DEFAULT_OPERATING_HOURS,
      });
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotCreate', 'Could not create shop'), message: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    setSaving(true);
    try {
      await updateShop(shopId, { name: name.trim() });
      toast({ type: 'success', title: t('common.saved', 'Saved') + ' ✓', message: t('settings.detailsUpdated', 'Shop details updated.') });
    } catch (e) {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function saveUpi() {
    setSavingUpi(true);
    try {
      await updateShop(shopId, {
        upiVpa: upiVpa.trim() || null,
        upiPayeeName: upiPayee.trim() || null,
      });
      toast({
        type: 'success',
        title: t('common.saved', 'Saved') + ' ✓',
        message: t('payments.upiUpdated', 'UPI payment details updated.'),
      });
    } catch (e) {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: String(e) });
    } finally {
      setSavingUpi(false);
    }
  }

  async function saveHours() {
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    // normalize loosely-typed input (e.g. "9:00" → "09:00") before validating
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
    setSaving(true);
    try {
      await updateShop(shopId, { operatingHours: normalized });
      toast({ type: 'success', title: t('common.saved', 'Saved') + ' ✓', message: t('settings.hoursUpdated', 'Operating hours updated.') });
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotSaveHours', 'Could not save hours'), message: String(e) });
    } finally {
      setSaving(false);
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

  async function saveKey() {    const key = keyInput.trim();
    if (!key) return;
    setSavingKey(true);
    try {
      await setFast2SmsKey(key);
      setFast2sms(key);
      setKeyInput('');
      toast({ type: 'success', title: t('common.saved', 'Saved'), message: t('settings.keyUpdated', 'Fast2SMS key updated.') });
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotSaveKey', 'Could not save key'), message: String(e) });
    } finally {
      setSavingKey(false);
    }
  }

  if (!canConfig) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('settings.title', 'Settings') }} />
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
        <Stack.Screen options={{ title: t('settings.title', 'Settings') }} />
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!shop) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('settings.title', 'Settings') }} />
        <SectionTitle>{t('settings.createShop', 'Create shop')}</SectionTitle>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.createShopHint', 'No shop exists yet. Give it a name to get started.')}
          </ThemedText>
          <TextField label={t('settings.shopName', 'Shop name')} value={name} onChangeText={setName} placeholder={t('settings.myShop', 'My Shop')} />
          <Button title={t('settings.createShop', 'Create shop')} loading={saving} onPress={() => void createShop()} />
        </Card>
      </Screen>
    );
  }

  const open = shopAcceptsOrders(shop);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.title', 'Settings') }} />

      <SectionTitle>{t('settings.language', 'Language')}</SectionTitle>
      <Card style={{ flexDirection: 'row', gap: Spacing.two }}>
        {LOCALES.map((l) => {
          const active = locale === l.code;
          return (
            <View key={l.code} style={{ flex: 1 }}>
              <Button
                title={l.label}
                variant={active ? 'primary' : 'secondary'}
                onPress={() => setLocale(l.code)}
              />
            </View>
          );
        })}
      </Card>

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

      <SectionTitle>{t('settings.shopDetails', 'Shop details')}</SectionTitle>
      <Card>
        <TextField label={t('settings.shopName', 'Shop name')} value={name} onChangeText={setName} placeholder={t('settings.myShop', 'My Shop')} />
        <Button title={t('settings.saveDetails', 'Save details')} loading={saving} onPress={() => void saveDetails()} />
      </Card>

      <SectionTitle>{t('payments.upiSection', 'UPI payments')}</SectionTitle>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {t('payments.upiNote', 'Buyers pay to this UPI ID. You confirm receipt manually on each order.')}
        </ThemedText>
        <TextField
          label={t('payments.vpa', 'UPI VPA')}
          value={upiVpa}
          onChangeText={setUpiVpa}
          placeholder="shop@okicici"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label={t('payments.payee', 'Payee name')}
          value={upiPayee}
          onChangeText={setUpiPayee}
          placeholder={t('settings.myShop', 'My Shop')}
        />
        <Button title={t('payments.saveUpi', 'Save UPI details')} loading={savingUpi} onPress={() => void saveUpi()} />
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
        <Button title={t('settings.saveHours', 'Save hours')} loading={saving} onPress={() => void saveHours()} />
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

      {canSecrets ? (
        <>
          <SectionTitle>{t('settings.fast2sms', 'Fast2SMS key')}</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {fast2sms ? t('settings.keySetMasked', 'Key set · {masked}', { masked: maskKey(fast2sms) }) : t('settings.notSet', 'Not set')}
              </ThemedText>
              <Badge label={fast2sms ? t('settings.keySet', 'Key set') : t('settings.notSet', 'Not set')} color={fast2sms ? SUCCESS : DANGER} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('settings.fast2smsWarn', 'WARNING: Stored in the database and read by the buyer app when sending OTP — a known, accepted exposure. For production, move it behind a server.')}
            </ThemedText>
            <TextField
              label={fast2sms ? t('settings.rotateKey', 'Rotate / replace key') : t('settings.newKey', 'New key')}
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder={t('settings.pasteKey', 'Paste Fast2SMS API key')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              title={fast2sms ? t('settings.saveReplaceKey', 'Save (replace key)') : t('settings.saveKey', 'Save key')}
              loading={savingKey}
              disabled={!keyInput.trim()}
              onPress={() => void saveKey()}
            />
          </Card>
        </>
      ) : null}

      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={{
          fontSize: 10,
          lineHeight: 14,
          textAlign: 'center',
          opacity: 0.6,
          marginTop: Spacing.four,
          marginBottom: Spacing.two,
        }}
      >
        made by Muhil Kennedy
      </ThemedText>
    </Screen>
  );
}
