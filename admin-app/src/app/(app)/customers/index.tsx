import { subscribeCustomers, userHasPermission, type Customer } from '@common';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, EmptyState, Screen, SectionTitle } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

export default function CustomersScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const canRead = userHasPermission(appUser, 'customers.read');

  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    if (!canRead) return;
    return subscribeCustomers(shopId, setCustomers);
  }, [canRead]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('customers.noViewHint', "Your role can't view customers.")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('customers.title', 'Customers') }} />

      <SectionTitle>{t('customers.title', 'Customers')}</SectionTitle>
      {customers.length === 0 ? (
        <EmptyState
          title={t('customers.noneTitle', 'No customers yet')}
          hint={t('customers.noneHint', 'Customers appear here once they sign up.')}
        />
      ) : (
        customers.map((c) => (
          <Card key={c.id} style={{ gap: Spacing.one }}>
            {/* Addresses live on the detail screen — the list stays scannable. */}
            <Pressable
              onPress={() => router.push(`/customers/${c.id}` as never)}
              style={{ gap: Spacing.one }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>
                  {c.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ›
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {c.email}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {c.phone || t('customers.noPhone', 'No phone')}
              </ThemedText>
            </Pressable>
          </Card>
        ))
      )}
    </Screen>
  );
}
