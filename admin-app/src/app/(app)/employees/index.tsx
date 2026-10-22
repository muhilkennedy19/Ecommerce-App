import {
  getIdToken,
  hasPermission,
  inviteEmployee,
  sendEmail,
  subscribeEmployees,
  type Employee,
  type EmployeeStatus,
} from '@common';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Screen, SectionTitle, SUCCESS, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { notifyUrl, shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const ORANGE = '#F5A623';

const STATUS_COLOR: Record<EmployeeStatus, string> = {
  invited: ORANGE,
  active: SUCCESS,
  disabled: DANGER,
};

export default function EmployeesScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const role = appUser?.role;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const canRead = hasPermission(role, 'employees.read');
  const canWrite = hasPermission(role, 'employees.write');

  useEffect(() => {
    if (!canRead) return;
    return subscribeEmployees(shopId, setEmployees);
  }, [canRead]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('employees.title', 'Employees') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('employees.noViewHint', "Your role can't view employees.")} />
      </Screen>
    );
  }

  async function onInvite() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      toast({ type: 'error', title: t('employees.missingDetails', 'Missing details'), message: t('employees.missingDetailsHint', 'Enter both a name and an email.') });
      return;
    }
    setInviting(true);
    try {
      const { token } = await inviteEmployee(shopId, trimmedName, trimmedEmail);
      setName('');
      setEmail('');

      let emailed = false;
      try {
        const idToken = await getIdToken();
        emailed = await sendEmail(notifyUrl, idToken, {
          to: trimmedEmail,
          subject: t('emp.inviteSubject', "You've been invited to the shop team"),
          text: t(
            'emp.inviteBody',
            'Hi {name},\n\nYou have been invited to join the shop team. Open the Seller app, sign in with this email ({email}) using Google, and you will be granted access.\n\nOnboarding code: {token}\n\nThanks.',
            { name: trimmedName, email: trimmedEmail, token },
          ),
        });
      } catch {
        emailed = false;
      }

      if (emailed) {
        toast({
          type: 'success',
          title: t('employees.invited', 'Employee invited'),
          message: t('emp.inviteEmailed', 'Invite email sent to {email}', { email: trimmedEmail }),
        });
      } else {
        // Email not configured/failed — fall back to the manual token hand-off so nothing is lost.
        toast({
          type: 'info',
          title: t('employees.invited', 'Employee invited'),
          message: t(
            'emp.inviteShareManually',
            "Couldn't email the invite. Share this onboarding code with the employee: {token}",
            { token },
          ),
        });
      }
    } catch (e) {
      toast({ type: 'error', title: t('employees.inviteFailed', 'Invite failed'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setInviting(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('employees.title', 'Employees') }} />

      {canWrite ? (
        <>
          <SectionTitle>{t('employees.invite', 'Invite employee')}</SectionTitle>
          <Card>
            <TextField label={t('employees.name', 'Name')} value={name} onChangeText={setName} placeholder={t('employees.fullName', 'Full name')} />
            <TextField
              label={t('employees.email', 'Email')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('employees.emailPlaceholder', 'name@example.com')}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title={t('employees.inviteBtn', 'Invite employee')} loading={inviting} onPress={() => void onInvite()} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('employees.inviteHint', 'Email delivery is stubbed on Spark — real email sending needs a server. For now, share the onboarding token shown after inviting.')}
            </ThemedText>
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('employees.team', 'Team')}</SectionTitle>
      {employees.length === 0 ? (
        <EmptyState title={t('employees.noneTitle', 'No employees yet')} hint={t('employees.noneHint', 'Invite someone to get started.')} />
      ) : (
        employees.map((emp) => (
          <Pressable key={emp.id} onPress={() => router.push(('/employees/' + emp.id) as never)}>
            <Card style={{ gap: Spacing.one }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ThemedText type="smallBold">{emp.name}</ThemedText>
                <Badge label={t(`employees.status.${emp.status}`, emp.status)} color={STATUS_COLOR[emp.status]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {emp.email}
              </ThemedText>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
