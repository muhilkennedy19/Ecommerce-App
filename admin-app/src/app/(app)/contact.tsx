import { subscribeShop, updateShop, userHasPermission, type Shop } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, EmptyState, Screen, SectionTitle, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { LocationPicker, type LatLng } from '@/components/location-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

/**
 * Shop contact details shown to buyers on the Contact-us tab: tagline, address, phones, email,
 * and the map location pin. Split out of the old monolithic Settings screen. Super-user + admin
 * only (the `shop.config` permission maps to exactly those two roles).
 */
export default function ContactDetails() {
  const appUser = useAuth().appUser;
  const { t } = useI18n();
  const toast = useToast();
  const canConfig = userHasPermission(appUser, 'shop.config');

  const [loaded, setLoaded] = useState(false);
  const initRef = useRef(false); // seed the form from the shop doc only once

  const [tagline, setTagline] = useState('');
  const [address, setAddress] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [pin, setPin] = useState<LatLng | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeShop(shopId, (s: Shop | null) => {
      setLoaded(true);
      if (s && !initRef.current) {
        initRef.current = true;
        setTagline(s.tagline ?? '');
        setAddress(s.address ?? '');
        setPhone1(s.contactPhone1 ?? '');
        setPhone2(s.contactPhone2 ?? '');
        setContactEmail(s.contactEmail ?? '');
        setPin(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
      }
    });
  }, [canConfig]);

  async function saveContact() {
    setSaving(true);
    try {
      await updateShop(shopId, {
        tagline: tagline.trim() || null,
        address: address.trim() || null,
        contactPhone1: phone1.trim() || null,
        contactPhone2: phone2.trim() || null,
        contactEmail: contactEmail.trim() || null,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
      });
      toast({
        type: 'success',
        title: t('common.saved', 'Saved') + ' ✓',
        message: t('settings.contactUpdated', 'Contact details updated.'),
      });
    } catch (e) {
      toast({ type: 'error', title: t('common.couldNotSave', 'Could not save'), message: String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!canConfig) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('settings.contactDetails', 'Contact details') }} />
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
        <Stack.Screen options={{ title: t('settings.contactDetails', 'Contact details') }} />
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.contactDetails', 'Contact details') }} />
      <SectionTitle>{t('settings.contactDetails', 'Contact details')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.contactHint', 'Shown to buyers on the Contact us tab of the buyer app.')}
        </ThemedText>
        <TextField
          label={t('settings.tagline', 'Tagline')}
          value={tagline}
          onChangeText={setTagline}
          placeholder={t('settings.taglinePlaceholder', 'Fresh groceries, delivered daily')}
        />
        <TextField
          label={t('settings.address', 'Address')}
          value={address}
          onChangeText={setAddress}
          placeholder={t('settings.addressPlaceholder', 'Door, street, area, city, pincode')}
          multiline
          numberOfLines={3}
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
        <TextField
          label={t('settings.phone1', 'Contact number 1')}
          value={phone1}
          onChangeText={setPhone1}
          placeholder="9876543210"
          keyboardType="phone-pad"
        />
        <TextField
          label={t('settings.phone2', 'Contact number 2')}
          value={phone2}
          onChangeText={setPhone2}
          placeholder="9876543210"
          keyboardType="phone-pad"
        />
        <TextField
          label={t('settings.contactEmail', 'Email')}
          value={contactEmail}
          onChangeText={setContactEmail}
          placeholder="shop@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ThemedText type="smallBold" style={{ marginTop: Spacing.one }}>
          {t('settings.locationPin', 'Shop location pin')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.locationPinHint', 'Lets buyers open directions to the shop in their maps app.')}
        </ThemedText>
        <LocationPicker value={pin} onChange={setPin} />
        <Button title={t('settings.saveContact', 'Save contact details')} loading={saving} onPress={() => void saveContact()} />
      </Card>
    </Screen>
  );
}
