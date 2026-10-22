import { isValidPhone, sanitizePhone, subscribeCustomers, updateCustomer, userHasPermission, type Customer } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, EmptyState, Screen, SectionTitle, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

export default function CustomersScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const canRead = userHasPermission(appUser, 'customers.read');
  const canWrite = userHasPermission(appUser, 'customers.write');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    return subscribeCustomers(shopId, setCustomers);
  }, [canRead]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('customers.noViewHint', "Your role can't view customers.")} />
      </Screen>
    );
  }

  function startEdit(c: Customer) {
    setEditId(c.id);
    setEditName(c.name ?? '');
    setEditPhone(c.phone ?? '');
    setEditAddress(c.address ?? '');
  }

  async function onSave(id: string) {
    if (!editName.trim()) {
      toast({ type: 'error', title: t('customers.missingName', 'Missing name'), message: t('customers.missingNameHint', 'Please enter a name.') });
      return;
    }
    if (editPhone.trim() && !isValidPhone(editPhone)) {
      toast({ type: 'error', title: t('customers.invalidPhone', 'Invalid phone'), message: t('checkout.phoneInvalid', 'Enter a 10-digit phone number.') });
      return;
    }
    setSaving(true);
    try {
      await updateCustomer(id, {
        name: editName.trim(),
        phone: editPhone.trim() || null,
        address: editAddress.trim() || null,
      });
      setEditId(null);
    } catch (e) {
      toast({ type: 'error', title: t('common.saveFailed', 'Save failed'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />

      <SectionTitle>{t('customers.title', 'Customers')}</SectionTitle>
      {customers.length === 0 ? (
        <EmptyState title={t('customers.noneTitle', 'No customers yet')} hint={t('customers.noneHint', 'Customers appear here once they sign up.')} />
      ) : (
        customers.map((c) => (
          <Card key={c.id} style={{ gap: Spacing.one }}>
            {editId === c.id ? (
              <View style={{ gap: Spacing.two }}>
                <TextField label={t('customers.name', 'Name')} value={editName} onChangeText={setEditName} />
                <TextField
                  label={t('customers.phone', 'Phone')}
                  value={editPhone}
                  onChangeText={(v) => setEditPhone(sanitizePhone(v))}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
                <TextField
                  label={t('customers.address', 'Address')}
                  value={editAddress}
                  onChangeText={setEditAddress}
                  multiline
                  numberOfLines={3}
                  style={{ minHeight: 72, textAlignVertical: 'top' }}
                />
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <View style={{ flex: 1 }}>
                    <Button title={t('common.save', 'Save')} loading={saving} onPress={() => void onSave(c.id)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title={t('common.cancel', 'Cancel')} variant="secondary" onPress={() => setEditId(null)} />
                  </View>
                </View>
              </View>
            ) : (
              <>
                <ThemedText type="smallBold">{c.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.email}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.phone || t('customers.noPhone', 'No phone')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.address || t('customers.noAddress', 'No address')}
                </ThemedText>
                {canWrite ? (
                  <Button title={t('common.edit', 'Edit')} variant="secondary" onPress={() => startEdit(c)} />
                ) : null}
              </>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}
