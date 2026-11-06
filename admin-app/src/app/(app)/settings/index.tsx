import {
  DEFAULT_OPERATING_HOURS,
  deleteImage,
  putImage,
  subscribeShop,
  updateShop,
  userHasPermission,
  type OccasionEffect,
  type Shop,
} from '@common';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, EmptyState, Screen, SectionTitle, TextField } from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { LOCALES, useI18n } from '@/lib/i18n';

/**
 * Shop basics: language, shop name, logo + festive icon effect, and UPI payment details.
 * Contact details and store configuration (hours, subscriptions, delivery areas) live on their
 * own screens (`/contact`, `/store`) reached from the dashboard. Gated to `shop.config`
 * (super-user + admin).
 */
export default function Settings() {
  const appUser = useAuth().appUser;
  const { t, locale, setLocale } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const canConfig = userHasPermission(appUser, 'shop.config');

  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const initRef = useRef(false); // populate the form from the shop doc only once

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const [upiVpa, setUpiVpa] = useState('');
  const [upiPayee, setUpiPayee] = useState('');
  const [savingUpi, setSavingUpi] = useState(false);

  // Festive overlay drawn on top of the buyer logo.
  const [iconEffect, setIconEffect] = useState<OccasionEffect>('none');

  const [savingLogo, setSavingLogo] = useState(false);
  const logoUri = useCachedImage(shop?.logoImageId);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeShop(shopId, (s) => {
      setShop(s);
      setLoaded(true);
      if (s && !initRef.current) {
        initRef.current = true;
        setName(s.name);
        setUpiVpa(s.upiVpa ?? '');
        setUpiPayee(s.upiPayeeName ?? '');
        setIconEffect(s.iconEffect ?? 'none');
      }
    });
  }, [canConfig]);

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

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    setSavingLogo(true);
    const previousId = shop?.logoImageId ?? null;
    try {
      // Logos render at ~140px, so 512px keeps the Firestore doc small.
      const ctx = ImageManipulator.manipulate(uri);
      ctx.resize({ width: 512 });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.PNG, base64: true });
      if (!out.base64) throw new Error('Could not process the selected image.');

      const imageId = await putImage(out.base64, 'image/png');
      await updateShop(shopId, { logoImageId: imageId });
      // Only drop the old blob once the new one is referenced.
      if (previousId) await deleteImage(previousId).catch(() => {});
      toast({
        type: 'success',
        title: t('common.saved', 'Saved') + ' ✓',
        message: t('settings.logoUpdated', 'Shop logo updated.'),
      });
    } catch (e) {
      toast({
        type: 'error',
        title: t('settings.logoFailed', 'Could not update logo'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingLogo(false);
    }
  }

  async function removeLogo() {
    const ok = await confirm({
      title: t('settings.logoRemove', 'Remove logo'),
      message: t('settings.logoRemoveConfirm', 'The buyer app will fall back to the default logo.'),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    const previousId = shop?.logoImageId ?? null;
    try {
      await updateShop(shopId, { logoImageId: null });
      if (previousId) await deleteImage(previousId).catch(() => {});
    } catch (e) {
      toast({
        type: 'error',
        title: t('settings.logoFailed', 'Could not update logo'),
        message: e instanceof Error ? e.message : String(e),
      });
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

  async function saveIconEffect(effect: OccasionEffect) {
    const previous = iconEffect;
    setIconEffect(effect); // optimistic
    try {
      await updateShop(shopId, { iconEffect: effect });
    } catch (e) {
      setIconEffect(previous); // revert on failure
      toast({ type: 'error', title: t('settings.couldNotUpdate', 'Could not update'), message: String(e) });
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

      <SectionTitle>{t('settings.shopDetails', 'Shop details')}</SectionTitle>
      <Card>
        <TextField label={t('settings.shopName', 'Shop name')} value={name} onChangeText={setName} placeholder={t('settings.myShop', 'My Shop')} />
        <Button title={t('settings.saveDetails', 'Save details')} loading={saving} onPress={() => void saveDetails()} />
      </Card>

      <SectionTitle>{t('settings.logo', 'Shop logo')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'settings.logoHint',
            'Shown on the buyer app launch screen with the shop name. Square images work best.',
          )}
        </ThemedText>
        <View style={{ alignItems: 'center' }}>
          {logoUri ? (
            <Image
              source={{ uri: logoUri }}
              style={{ width: 120, height: 120, borderRadius: Spacing.two }}
              contentFit="contain"
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('settings.logoNone', 'No logo uploaded yet.')}
            </ThemedText>
          )}
        </View>
        <Button
          title={logoUri ? t('settings.logoChange', 'Change logo') : t('settings.logoPick', 'Upload logo')}
          variant="secondary"
          loading={savingLogo}
          onPress={() => void pickLogo()}
        />
        {shop?.logoImageId ? (
          <Button
            title={t('settings.logoRemove', 'Remove logo')}
            variant="danger"
            onPress={() => void removeLogo()}
          />
        ) : null}
      </Card>

      <SectionTitle>{t('settings.iconEffect', 'Logo icon effect')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.iconEffectHint', 'A festive decoration shown on top of your logo in the buyer app.')}
        </ThemedText>
        {(
          [
            { key: 'none', glyph: '', label: t('settings.effectNone', 'Default (no effect)') },
            { key: 'fireworks', glyph: '🎆', label: t('settings.effectFireworks', 'Fireworks · Diwali') },
            { key: 'flag', glyph: '🇮🇳', label: t('settings.effectFlag', 'Indian flag · Republic / Independence Day') },
            { key: 'santa', glyph: '🎅', label: t('settings.effectSanta', 'Santa cap · Christmas / New Year') },
          ] as { key: OccasionEffect; glyph: string; label: string }[]
        ).map((e) => (
          <Button
            key={e.key}
            title={e.glyph ? `${e.glyph}  ${e.label}` : e.label}
            variant={iconEffect === e.key ? 'primary' : 'secondary'}
            onPress={() => void saveIconEffect(e.key)}
          />
        ))}
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
