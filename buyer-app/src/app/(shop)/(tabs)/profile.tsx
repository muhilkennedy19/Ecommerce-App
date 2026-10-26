import { getCustomer, isValidPhone, sanitizePhone, saveAddresses, setCustomerPhone, type Address } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useToast } from '@/components/feedback';
import { LocationPicker } from '@/components/location-picker';
import { Badge, Button, Card, DANGER, EmptyState, PRIMARY, Screen, SectionTitle, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { LOCALES, useI18n } from '@/lib/i18n';

export default function Profile() {
  const { user } = useAuth();
  const theme = useTheme();
  const { locale, setLocale, t } = useI18n();
  const toast = useToast();
  const uid = user?.uid;

  const [phone, setPhone] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [defaultAddressId, setDefaultAddressId] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingAddresses, setSavingAddresses] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    getCustomer(uid)
      .then((c) => {
        if (!active || !c) return;
        setPhone(c.phone ?? '');
        setAddresses(c.addresses ?? []);
        setDefaultAddressId(c.defaultAddressId ?? null);
      })
      .catch(() => {
        // non-fatal — the buyer can still fill the form from scratch
      });
    return () => {
      active = false;
    };
  }, [uid]);

  const savePhone = async () => {
    if (!uid) return;
    if (!isValidPhone(phone)) {
      toast({
        type: 'error',
        title: t('profile.phoneInvalidTitle', 'Invalid phone'),
        message: t('checkout.phoneInvalid', 'Enter a 10-digit phone number.'),
      });
      return;
    }
    setSavingPhone(true);
    try {
      await setCustomerPhone(uid, phone.trim());
      toast({
        type: 'success',
        title: t('common.saved', 'Saved ✓'),
        message: t('profile.phoneSaved', 'Your phone number has been updated.'),
      });
    } catch {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setSavingPhone(false);
    }
  };

  const updateAddress = (id: string, patch: Partial<Address>) =>
    setAddresses((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const addAddress = () =>
    setAddresses((prev) => [
      ...prev,
      { id: `a${Date.now()}${prev.length}`, label: '', door: '', street: '', city: '', pincode: '', landmark: '' },
    ]);

  const deleteAddress = (id: string) => {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    setDefaultAddressId((cur) => (cur === id ? null : cur));
  };

  const saveAddressList = async () => {
    if (!uid) return;
    setSavingAddresses(true);
    try {
      await saveAddresses(uid, addresses, defaultAddressId);
      toast({
        type: 'success',
        title: t('common.saved', 'Saved ✓'),
        message: t('profile.addressesSaved', 'Your addresses have been updated.'),
      });
    } catch {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setSavingAddresses(false);
    }
  };

  if (!user) return null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile.title', 'Profile') }} />

      <Card style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{user.displayName ?? t('profile.buyer', 'Buyer')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {user.email ?? t('profile.noEmail', 'No email')}
        </ThemedText>
      </Card>

      <SectionTitle>{t('profile.language', 'Language')}</SectionTitle>
      <Card>
        <View style={styles.langRow}>
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <Pressable
                key={l.code}
                onPress={() => setLocale(l.code)}
                style={[
                  styles.langChip,
                  {
                    backgroundColor: active ? PRIMARY : theme.backgroundSelected,
                    borderColor: active ? PRIMARY : theme.backgroundSelected,
                  },
                ]}
              >
                <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                  {l.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionTitle>{t('profile.phone', 'Phone')}</SectionTitle>
      <Card>
        <TextField
          label={t('common.phoneNumber', 'Phone number')}
          value={phone}
          onChangeText={(v) => setPhone(sanitizePhone(v))}
          keyboardType="phone-pad"
          maxLength={10}
          placeholder={t('profile.phonePlaceholder', 'e.g. 9876543210')}
        />
        {phone.length > 0 && !isValidPhone(phone) ? (
          <ThemedText type="small" style={{ color: DANGER }}>
            {t('checkout.phoneInvalid', 'Enter a 10-digit phone number.')}
          </ThemedText>
        ) : null}
        <View style={{ alignSelf: 'flex-start', marginTop: Spacing.one }}>
          <Button title={t('common.save', 'Save')} onPress={savePhone} loading={savingPhone} />
        </View>
      </Card>

      <SectionTitle>{t('profile.addresses', 'Addresses')}</SectionTitle>
      {addresses.length === 0 ? (
        <EmptyState
          title={t('profile.noAddresses', 'No addresses yet')}
          hint={t('profile.noAddressesHint', 'Add a delivery address to speed up checkout.')}
        />
      ) : (
        addresses.map((a) => {
          const isDefault = a.id === defaultAddressId;
          return (
            <Card key={a.id} style={{ gap: Spacing.two }}>
              {isDefault ? <Badge label={t('profile.default', 'Default')} /> : null}
              <TextField
                label={t('profile.labelOptional', 'Label (optional)')}
                value={a.label ?? ''}
                onChangeText={(v) => updateAddress(a.id, { label: v })}
                placeholder={t('profile.labelPlaceholder', 'Home, Work…')}
              />
              <TextField
                label={t('profile.door', 'Door / Flat')}
                value={a.door}
                onChangeText={(v) => updateAddress(a.id, { door: v })}
              />
              <TextField
                label={t('profile.street', 'Street')}
                value={a.street}
                onChangeText={(v) => updateAddress(a.id, { street: v })}
              />
              <TextField
                label={t('profile.city', 'City')}
                value={a.city}
                onChangeText={(v) => updateAddress(a.id, { city: v })}
              />
              <TextField
                label={t('profile.pincode', 'Pincode')}
                value={a.pincode}
                onChangeText={(v) => updateAddress(a.id, { pincode: v })}
                keyboardType="numeric"
              />
              <TextField
                label={t('profile.landmark', 'Landmark (optional)')}
                value={a.landmark ?? ''}
                onChangeText={(v) => updateAddress(a.id, { landmark: v })}
              />
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
                {t('profile.deliveryLocation', 'Delivery location')}
              </ThemedText>
              <LocationPicker
                value={a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null}
                onChange={(c) => updateAddress(a.id, { lat: c.lat, lng: c.lng })}
              />
              <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one }}>
                {!isDefault ? (
                  <Button title={t('profile.setDefault', 'Set default')} variant="secondary" onPress={() => setDefaultAddressId(a.id)} />
                ) : null}
                <Button title={t('common.delete', 'Delete')} variant="danger" onPress={() => deleteAddress(a.id)} />
              </View>
            </Card>
          );
        })
      )}

      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
        <Button title={t('profile.addAddress', 'Add address')} variant="secondary" onPress={addAddress} />
        <Button title={t('profile.saveAddresses', 'Save addresses')} onPress={saveAddressList} loading={savingAddresses} />
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
        made by Muhil Kennedy
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  langChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
  credit: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    opacity: 0.6,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
});
