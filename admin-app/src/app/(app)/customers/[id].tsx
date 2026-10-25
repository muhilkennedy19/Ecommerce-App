import {
  getCustomer,
  isValidPhone,
  sanitizePhone,
  subscribeCustomers,
  updateCustomer,
  userHasPermission,
  type Address,
  type Customer,
} from '@common';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/feedback';
import { Badge, Button, Card, EmptyState, Loader, Screen, SectionTitle, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

function formatAddress(a: Address): string {
  return [a.door, a.street, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const canRead = userHasPermission(appUser, 'customers.read');
  const canWrite = userHasPermission(appUser, 'customers.write');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // Live feed so edits made elsewhere (or by the buyer) show up immediately.
  useEffect(() => {
    if (!canRead || !id) return;
    return subscribeCustomers(shopId, (list) => {
      const found = list.find((c) => c.id === id) ?? null;
      setCustomer(found);
      setLoading(false);
    });
  }, [canRead, id]);

  // Fallback for a customer outside this shop's live query.
  useEffect(() => {
    if (!canRead || !id || customer) return;
    let active = true;
    void getCustomer(id).then((c) => {
      if (!active) return;
      if (c) setCustomer(c);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [canRead, id, customer]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.detail', 'Customer') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('customers.noViewHint', "Your role can't view customers.")}
        />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.detail', 'Customer') }} />
        <Loader label={t('common.loading', 'Loading…')} />
      </Screen>
    );
  }

  if (!customer) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.detail', 'Customer') }} />
        <EmptyState
          title={t('customers.notFound', 'Customer not found')}
          hint={t('customers.notFoundHint', 'This customer may have been removed.')}
        />
      </Screen>
    );
  }

  const startEdit = () => {
    setEditName(customer.name ?? '');
    setEditPhone(customer.phone ?? '');
    setEditing(true);
  };

  const onSave = async () => {
    if (!editName.trim()) {
      toast({
        type: 'error',
        title: t('customers.missingName', 'Missing name'),
        message: t('customers.missingNameHint', 'Please enter a name.'),
      });
      return;
    }
    if (editPhone.trim() && !isValidPhone(editPhone)) {
      toast({
        type: 'error',
        title: t('customers.invalidPhone', 'Invalid phone'),
        message: t('checkout.phoneInvalid', 'Enter a 10-digit phone number.'),
      });
      return;
    }
    setSaving(true);
    try {
      await updateCustomer(customer.id, {
        name: editName.trim(),
        phone: editPhone.trim() || null,
      });
      setEditing(false);
    } catch (e) {
      toast({
        type: 'error',
        title: t('common.saveFailed', 'Save failed'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  // Buyers save structured `addresses[]`; `address` is the legacy single-line field.
  const addresses = customer.addresses ?? [];
  const legacyAddress = customer.address?.trim();

  return (
    <Screen>
      <Stack.Screen options={{ title: customer.name || t('customers.detail', 'Customer') }} />

      <SectionTitle>{t('customers.details', 'Details')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        {editing ? (
          <>
            <TextField label={t('customers.name', 'Name')} value={editName} onChangeText={setEditName} />
            <TextField
              label={t('customers.phone', 'Phone')}
              value={editPhone}
              onChangeText={(v) => setEditPhone(sanitizePhone(v))}
              keyboardType="phone-pad"
              maxLength={10}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.two }}>
              <View style={{ flex: 1 }}>
                <Button title={t('common.save', 'Save')} loading={saving} onPress={() => void onSave()} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={t('common.cancel', 'Cancel')}
                  variant="secondary"
                  onPress={() => setEditing(false)}
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <Row label={t('customers.name', 'Name')} value={customer.name} />
            <Row label={t('customers.email', 'Email')} value={customer.email} />
            <Row
              label={t('customers.phone', 'Phone')}
              value={customer.phone || t('customers.noPhone', 'No phone')}
            />
            {customer.locale ? (
              <Row label={t('customers.locale', 'Language')} value={customer.locale} />
            ) : null}
            {canWrite ? (
              <Button title={t('common.edit', 'Edit')} variant="secondary" onPress={startEdit} />
            ) : null}
          </>
        )}
      </Card>

      <SectionTitle>
        {t('customers.addresses', 'Delivery addresses ({count})', { count: addresses.length })}
      </SectionTitle>
      {addresses.length === 0 && !legacyAddress ? (
        <EmptyState
          title={t('customers.noAddress', 'No address')}
          hint={t('customers.noAddressHint', 'The customer has not saved an address yet.')}
        />
      ) : (
        <>
          {addresses.map((a) => (
            <Card key={a.id} style={{ gap: Spacing.one }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>
                  {a.label || t('customers.address', 'Address')}
                </ThemedText>
                {customer.defaultAddressId === a.id ? (
                  <Badge label={t('customers.default', 'Default')} />
                ) : null}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {formatAddress(a)}
              </ThemedText>
            </Card>
          ))}
          {legacyAddress ? (
            <Card style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold">{t('customers.addressOld', 'Older address')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {legacyAddress}
              </ThemedText>
            </Card>
          ) : null}
        </>
      )}

      {customer.notifyBackInStock?.length ? (
        <>
          <SectionTitle>{t('customers.watchlist', 'Back-in-stock alerts')}</SectionTitle>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              {t('customers.watchingCount', 'Watching {count} product(s).', {
                count: customer.notifyBackInStock.length,
              })}
            </ThemedText>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.two }}>
      <ThemedText type="small" themeColor="textSecondary" style={{ width: 92 }}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={{ flex: 1 }}>
        {value}
      </ThemedText>
    </View>
  );
}
