import {
  purgeCustomers,
  purgeOrders,
  purgeProducts,
  purgeUsersExceptCurrent,
  userHasRole,
} from '@common';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { Button, Card, DANGER, EmptyState, Screen, SectionTitle } from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type ActionKey = 'products' | 'orders' | 'customers' | 'users';

interface PurgeAction {
  key: ActionKey;
  title: string;
  description: string;
  label: string;
  run: () => Promise<number>;
}

export default function PurgeScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [running, setRunning] = useState<ActionKey | null>(null);

  if (!userHasRole(appUser, 'superuser')) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('purge.title', 'Purge data') }} />
        <EmptyState title={t('purge.superuserOnly', 'Superuser only')} hint={t('purge.superuserOnlyHint', 'This tool is restricted to superusers.')} />
      </Screen>
    );
  }

  // Reached only when the user is a superuser, so appUser is non-null here.
  const uid = appUser!.uid;

  const actions: PurgeAction[] = [
    {
      key: 'products',
      title: t('purge.products.title', 'Delete all products'),
      description: t('purge.products.desc', 'Permanently removes every product and category.'),
      label: t('purge.products.label', 'all products'),
      run: purgeProducts,
    },
    {
      key: 'orders',
      title: t('purge.orders.title', 'Delete all orders & history'),
      description: t('purge.orders.desc', 'Permanently removes every order and its history.'),
      label: t('purge.orders.label', 'all orders & history'),
      run: purgeOrders,
    },
    {
      key: 'customers',
      title: t('purge.customers.title', 'Delete all customers'),
      description: t('purge.customers.desc', 'Permanently removes every customer record.'),
      label: t('purge.customers.label', 'all customers'),
      run: purgeCustomers,
    },
    {
      key: 'users',
      title: t('purge.users.title', 'Delete all users except me'),
      description: t('purge.users.desc', 'Removes every other admin user, pending request, and team member (invited employees included).'),
      label: t('purge.users.label', 'all users except me'),
      run: () => purgeUsersExceptCurrent(uid),
    },
  ];

  async function execute(action: PurgeAction) {
    setRunning(action.key);
    try {
      const count = await action.run();
      toast({ type: 'success', title: t('common.done', 'Done'), message: t('purge.deletedCount', 'Deleted {count} records.', { count }) });
    } catch (e) {
      toast({ type: 'error', title: t('purge.failed', 'Purge failed'), message: errMsg(e) });
    } finally {
      setRunning(null);
    }
  }

  async function confirmAction(action: PurgeAction) {
    const first = await confirm({
      title: t('purge.confirmTitle', 'Delete {label}?', { label: action.label }),
      message: t('purge.confirmHint', 'This cannot be undone.'),
      confirmText: t('common.continue', 'Continue'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!first) return;
    const second = await confirm({
      title: t('purge.confirm2Title', 'Are you absolutely sure?'),
      message: t('purge.confirm2Hint', 'This permanently deletes data.'),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!second) return;
    await execute(action);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('purge.title', 'Purge data') }} />

      <Card style={{ borderWidth: 1, borderColor: DANGER, gap: Spacing.two }}>
        <ThemedText type="smallBold" style={{ color: DANGER }}>
          {t('purge.dangerZone', '⚠️ Danger zone')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('purge.dangerHint', 'These actions permanently delete data and cannot be undone. They are intended only for initial onboarding and testing resets.')}
        </ThemedText>
      </Card>

      <SectionTitle>{t('purge.destructive', 'Destructive actions')}</SectionTitle>
      {actions.map((action) => (
        <Card key={action.key} style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">{action.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {action.description}
          </ThemedText>
          <Button
            title={action.title}
            variant="danger"
            loading={running === action.key}
            disabled={running !== null}
            onPress={() => void confirmAction(action)}
          />
        </Card>
      ))}
    </Screen>
  );
}
