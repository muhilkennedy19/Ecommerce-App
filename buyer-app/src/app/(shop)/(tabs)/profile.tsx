import {
  ensureReferralCode,
  findCustomerByReferralCode,
  getCustomer,
  isValidPhone,
  isValidReferralCode,
  loyaltyConfig,
  pointsToRupees,
  referralCodeFor,
  referralsActive,
  sanitizePhone,
  saveAddresses,
  setCustomerPhone,
  setReferredBy,
  subscribeShop,
  type Address,
  type LoyaltyConfig,
} from '@common';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { useToast, useConfirm } from '@/components/feedback';
import { LocationPicker } from '@/components/location-picker';
import { Badge, Button, Card, DANGER, EmptyState, PRIMARY, Screen, SectionTitle, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { LOCALES, useI18n } from '@/lib/i18n';

export default function Profile() {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const { locale, setLocale, t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const uid = user?.uid;

  const [phone, setPhone] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [defaultAddressId, setDefaultAddressId] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingAddresses, setSavingAddresses] = useState(false);

  // Rewards. `points`/`referredBy` mirror the customer doc; the shop doc decides whether any
  // of this is shown at all.
  const [loyalty, setLoyalty] = useState<LoyaltyConfig | null>(null);
  const [playStoreUrl, setPlayStoreUrl] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [referredByCode, setReferredByCode] = useState<string | null>(null);
  const [codeNeedsPublishing, setCodeNeedsPublishing] = useState(false);
  const [friendCode, setFriendCode] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const myCode = uid ? referralCodeFor(uid) : '';

  useEffect(
    () =>
      subscribeShop(shopId, (s) => {
        setLoyalty(s?.loyalty ?? null);
        setPlayStoreUrl(s?.playStoreUrl?.trim() || null);
      }),
    [],
  );

  /**
   * Pull the customer doc into local state. Points are minted by the ADMIN app when an order
   * is served, so this screen has no way of knowing it happened — re-reading on mount and on
   * pull-to-refresh is what keeps the balance honest without a second live listener.
   */
  const loadCustomer = useCallback(async () => {
    if (!uid) return;
    const c = await getCustomer(uid);
    if (!c) return;
    setPhone(c.phone ?? '');
    setAddresses(c.addresses ?? []);
    setDefaultAddressId(c.defaultAddressId ?? null);
    setPoints(c.loyaltyPoints ?? 0);
    setReferredByCode(c.referredBy ?? null);
    setCodeNeedsPublishing(c.referralCode !== referralCodeFor(uid));
  }, [uid]);

  useEffect(() => {
    loadCustomer().catch(() => {
      // non-fatal — the buyer can still fill the form from scratch
    });
  }, [loadCustomer]);

  // Refresh whenever the tab regains focus too, so coming back from a delivered order
  // shows the new balance without the buyer having to pull.
  useFocusEffect(
    useCallback(() => {
      loadCustomer().catch(() => {});
    }, [loadCustomer]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadCustomer()
      .catch(() => {
        toast({
          type: 'error',
          title: t('profile.refreshFailed', 'Could not refresh'),
          message: t('common.tryAgain', 'Please try again.'),
        });
      })
      .finally(() => setRefreshing(false));
  };

  // Publish our own share code once, so a friend entering it can be resolved back to us.
  // Rules only accept the uid-derived value, so this is a safe self-write.
  useEffect(() => {
    if (!uid || !codeNeedsPublishing) return;
    ensureReferralCode(uid, referralCodeFor(uid))
      .then(() => setCodeNeedsPublishing(false))
      .catch(() => {
        // retried next time the profile opens
      });
  }, [uid, codeNeedsPublishing]);

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

  const shareMyCode = () => {
    // The install link is appended only once the shop has published the app — before that a
    // bare code is still shareable with someone who already has it installed.
    const lines = [
      t(
        'profile.referralShare',
        'Use my code {code} when you order — we both get reward points!',
        { code: myCode },
      ),
    ];
    if (playStoreUrl) {
      lines.push(t('profile.referralShareInstall', 'Get the app: {url}', { url: playStoreUrl }));
    }
    void Share.share({ message: lines.join('\n\n') }).catch(() => {
      // user dismissed the sheet, or the platform refused — nothing to report
    });
  };

  const applyFriendCode = async () => {
    if (!uid) return;
    const code = friendCode.trim().toUpperCase();
    if (!isValidReferralCode(code)) {
      toast({
        type: 'error',
        title: t('profile.codeInvalid', 'Invalid code'),
        message: t('profile.codeInvalidHint', 'Referral codes look like REFAB12CD.'),
      });
      return;
    }
    if (code === myCode) {
      toast({
        type: 'error',
        title: t('profile.codeSelf', "That's your own code"),
        message: t('profile.codeSelfHint', 'Share it with a friend instead.'),
      });
      return;
    }
    setApplyingCode(true);
    try {
      const referrer = await findCustomerByReferralCode(shopId, code);
      if (!referrer) {
        toast({
          type: 'error',
          title: t('profile.codeUnknown', 'Code not found'),
          message: t('profile.codeUnknownHint', 'Check the code with your friend and try again.'),
        });
        return;
      }
      await setReferredBy(uid, code);
      setReferredByCode(code);
      setFriendCode('');
      toast({
        type: 'success',
        title: t('profile.codeApplied', 'Code applied ✓'),
        message: t(
          'profile.codeAppliedHint',
          'You both get bonus points once your first order is delivered.',
        ),
      });
    } catch {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setApplyingCode(false);
    }
  };

  const confirmSignOut = async () => {    const ok = await confirm({
      title: t('common.signOut', 'Sign out'),
      message: t('profile.signOutConfirm', 'Sign out of your account on this device?'),
      confirmText: t('common.signOut', 'Sign out'),
      destructive: true,
    });
    if (ok) await signOut();
    // The (shop) auth gate redirects to sign-in once the user becomes null.
  };

  if (!user) return null;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: t('profile.title', 'Profile') }} />

      <Card style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{user.displayName ?? t('profile.buyer', 'Buyer')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {user.email ?? t('profile.noEmail', 'No email')}
        </ThemedText>
      </Card>

      {loyaltyConfig(loyalty).enabled ? (
        <>
          <SectionTitle>{t('profile.rewards', 'Rewards')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
                🎁
              </ThemedText>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {t('profile.pointsBalance', '{points} points', { points })}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('profile.pointsWorth', 'Worth ₹{value} at checkout', {
                    value: pointsToRupees(loyalty, points),
                  })}
                </ThemedText>
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t(
                'profile.pointsHint',
                'You earn {rate} points per ₹100 spent. Points land once your order is delivered.',
                { rate: loyaltyConfig(loyalty).earnPerHundred },
              )}
            </ThemedText>
          </Card>

          {referralsActive(loyalty) ? (
            <Card style={{ gap: Spacing.two }}>
              <ThemedText type="smallBold">
                {t('profile.inviteFriends', 'Invite friends')}
              </ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <Badge label={myCode} color={PRIMARY} />
                <View style={{ flex: 1 }}>
                  <Button
                    title={t('profile.shareCode', 'Share my code')}
                    variant="secondary"
                    size="sm"
                    onPress={shareMyCode}
                  />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t(
                  'profile.inviteHint',
                  'Your friend gets {referee} points on their first delivered order, and you get {referrer}.',
                  {
                    referee: loyaltyConfig(loyalty).refereeBonus,
                    referrer: loyaltyConfig(loyalty).referrerBonus,
                  },
                )}
              </ThemedText>

              {referredByCode ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('profile.referredByLabel', 'Referred by {code} ✓', { code: referredByCode })}
                </ThemedText>
              ) : (
                <>
                  <TextField
                    label={t('profile.friendCode', "Have a friend's code?")}
                    value={friendCode}
                    onChangeText={(v) => setFriendCode(v.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={9}
                    placeholder="REFAB12CD"
                  />
                  <Button
                    title={t('profile.applyCode', 'Apply code')}
                    variant="secondary"
                    onPress={() => void applyFriendCode()}
                    loading={applyingCode}
                    disabled={!friendCode.trim()}
                  />
                </>
              )}
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionTitle>{t('profile.language', 'Language')}</SectionTitle>      <Card>
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

      <SectionTitle>{t('profile.account', 'Account')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <Button
          title={t('subscribe.manageTitle', 'My subscriptions')}
          variant="secondary"
          onPress={() => router.push('/subscriptions')}
        />
        <Button title={t('common.signOut', 'Sign out')} variant="secondary" onPress={() => void confirmSignOut()} />
      </Card>

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
