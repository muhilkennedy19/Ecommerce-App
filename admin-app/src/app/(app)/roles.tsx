import {
  ALL_ROLES,
  assignRole,
  removeUser,
  ROLE_LABELS,
  rolesOf,
  setUserActive,
  subscribePendingUsers,
  subscribeUsers,
  updateUserRoles,
  userHasPermission,
  userHasRole,
  type AppUser,
  type PendingUser,
  type Role,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  PRIMARY,
  Screen,
  SectionTitle,
  SUCCESS,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function RolePills({
  roles,
  selected,
  onToggle,
  disabled,
}: {
  roles: Role[];
  selected: Role[];
  onToggle: (role: Role) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.pills}>
      {roles.map((r) => {
        const active = selected.includes(r);
        return (
          <Pressable
            key={r}
            disabled={disabled}
            onPress={() => onToggle(r)}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: active ? PRIMARY : theme.backgroundSelected,
                backgroundColor: active ? PRIMARY + '22' : 'transparent',
                opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <ThemedText type="small" style={active ? { color: PRIMARY } : undefined}>
              {active ? '✓ ' : ''}{ROLE_LABELS[r]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function toggleRole(list: Role[], role: Role): Role[] {
  return list.includes(role) ? list.filter((r) => r !== role) : [...list, role];
}

export default function RolesScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = userHasPermission(appUser, 'roles.manage');
  const isSuper = userHasRole(appUser, 'superuser');

  const [users, setUsers] = useState<AppUser[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [pendingSel, setPendingSel] = useState<Record<string, Role[]>>({});

  // Only a superuser may grant or alter the superuser role (mirrors Security Rules).
  const selectableRoles = useMemo(
    () => ALL_ROLES.filter((r) => r !== 'superuser' || isSuper),
    [isSuper],
  );

  // Hide superuser accounts from non-superuser viewers.
  const visibleUsers = useMemo(
    () => (isSuper ? users : users.filter((u) => !rolesOf(u).includes('superuser'))),
    [isSuper, users],
  );

  useEffect(() => {
    if (!canManage) return;
    const unsubUsers = subscribeUsers(shopId, setUsers);
    const unsubPending = subscribePendingUsers(setPending);
    return () => {
      unsubUsers();
      unsubPending();
    };
  }, [canManage]);

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('roles.title', 'Team & Roles') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('roles.noAccessHint', "Your role can't manage team roles.")} />
      </Screen>
    );
  }

  async function onGrant(p: PendingUser) {
    const roles = pendingSel[p.uid] ?? [];
    if (roles.length === 0) {
      toast({ type: 'error', title: t('roles.pickRole', 'Pick a role'), message: t('roles.pickRoleHint', 'Select at least one role before granting access.') });
      return;
    }
    try {
      await assignRole({ uid: p.uid, email: p.email, name: p.name, roles, shopId });
    } catch (e) {
      toast({ type: 'error', title: t('roles.grantFailed', 'Grant failed'), message: errMsg(e) });
    }
  }

  async function onToggleRole(u: AppUser, role: Role) {
    const next = toggleRole(rolesOf(u), role);
    if (next.length === 0) {
      toast({ type: 'error', title: t('roles.pickRole', 'Pick a role'), message: t('roles.needOneHint', 'A user must keep at least one role.') });
      return;
    }
    try {
      await updateUserRoles(u.uid, next);
    } catch (e) {
      toast({ type: 'error', title: t('common.updateFailed', 'Update failed'), message: errMsg(e) });
    }
  }

  async function onToggleActive(u: AppUser, active: boolean) {
    try {
      await setUserActive(u.uid, active);
    } catch (e) {
      toast({ type: 'error', title: t('common.updateFailed', 'Update failed'), message: errMsg(e) });
    }
  }

  async function onRemove(u: AppUser) {
    const ok = await confirm({
      title: t('roles.removeUser', 'Remove user'),
      message: t('roles.removeConfirm', 'Remove {name}? This revokes their access to the shop.', { name: u.name || u.email }),
      confirmText: t('common.remove', 'Remove'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeUser(u.uid);
    } catch (e) {
      toast({ type: 'error', title: t('roles.removeFailed', 'Remove failed'), message: errMsg(e) });
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('roles.title', 'Team & Roles') }} />

      {pending.length > 0 ? (
        <>
          <SectionTitle>{t('roles.pending', 'Pending requests')}</SectionTitle>
          {pending.map((p) => {
            const selected = pendingSel[p.uid] ?? [];
            return (
              <Card key={p.uid} style={{ gap: Spacing.two }}>
                <ThemedText type="smallBold">{p.name || p.email}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {p.email}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('roles.pickMulti', 'Tap one or more roles')}
                </ThemedText>
                <RolePills
                  roles={selectableRoles}
                  selected={selected}
                  onToggle={(role) => setPendingSel((prev) => ({ ...prev, [p.uid]: toggleRole(prev[p.uid] ?? [], role) }))}
                />
                <Button
                  title={t('roles.grant', 'Grant access')}
                  disabled={selected.length === 0}
                  onPress={() => void onGrant(p)}
                />
              </Card>
            );
          })}
        </>
      ) : null}

      <SectionTitle>{t('roles.team', 'Team')}</SectionTitle>
      {visibleUsers.length === 0 ? (
        <EmptyState title={t('roles.noneTitle', 'No team members yet')} hint={t('roles.noneHint', 'Grant a pending request to add someone.')} />
      ) : (
        visibleUsers.map((u) => {
          const isSelf = u.uid === appUser?.uid;
          // Non-superusers can't touch superuser rows or their own row.
          const canEdit = isSuper || (!rolesOf(u).includes('superuser') && !isSelf);
          return (
            <Card key={u.uid} style={{ gap: Spacing.two }}>
              <View style={styles.rowBetween}>
                <ThemedText type="smallBold">{u.name || u.email}</ThemedText>
                <View style={styles.badges}>
                  {rolesOf(u).map((r) => (
                    <Badge key={r} label={ROLE_LABELS[r]} />
                  ))}
                  <Badge
                    label={u.active ? t('roles.active', 'Active') : t('roles.disabled', 'Disabled')}
                    color={u.active ? SUCCESS : DANGER}
                  />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {u.email}
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary">
                {canEdit ? t('roles.tapToToggle', 'Tap roles to add or remove') : t('roles.locked', 'Role locked')}
              </ThemedText>
              <RolePills
                roles={selectableRoles}
                selected={rolesOf(u)}
                disabled={!canEdit}
                onToggle={(role) => void onToggleRole(u, role)}
              />

              <View style={styles.rowBetween}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('roles.activeLabel', 'Active')}
                </ThemedText>
                <Switch
                  value={u.active}
                  disabled={!canEdit}
                  onValueChange={(v) => void onToggleActive(u, v)}
                  trackColor={{ true: PRIMARY }}
                />
              </View>

              {isSuper ? (
                <Button
                  title={t('common.remove', 'Remove')}
                  variant="danger"
                  disabled={isSelf}
                  onPress={() => onRemove(u)}
                />
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
});
