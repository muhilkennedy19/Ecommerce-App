import type { Role } from '../types';

/**
 * Permission keys. The SAME keys are enforced client-side (nav/screens) and
 * server-side (Firestore/Storage Security Rules via the user's role).
 */
export const PERMISSIONS = [
  'products.read',
  'products.write',
  'categories.write',
  'employees.read',
  'employees.write',
  'customers.read',
  'customers.write',
  'orders.read',
  'orders.serve',
  'analytics.read',
  'shop.config',
  'sales.discount',
  'sales.override',
  'roles.manage',
  'secrets.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  superuser: ALL,
  admin: [
    'shop.config',
    'sales.discount',
    'sales.override',
    'products.read',
    'categories.write',
    'customers.read',
    'orders.read',
    'orders.serve',
    'analytics.read',
    'secrets.manage',
    'roles.manage',
  ],
  'product-manager': ['products.read', 'products.write', 'categories.write'],
  'employee-manager': ['employees.read', 'employees.write', 'roles.manage'],
  'customer-manager': ['customers.read', 'customers.write'],
  sales: ['orders.read', 'orders.serve'],
  analytics: ['analytics.read', 'orders.read'],
};

export function hasPermission(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export function hasAnyPermission(role: Role | undefined | null, perms: Permission[]): boolean {
  return perms.some((p) => hasPermission(role, p));
}

/** A user-like object carrying one or more roles. */
interface RoleBearer {
  role?: Role | null;
  roles?: Role[] | null;
}

/** All roles granted to a user — the `roles` array if present, else `[role]`. */
export function rolesOf(user: RoleBearer | null | undefined): Role[] {
  if (!user) return [];
  if (user.roles && user.roles.length > 0) return user.roles;
  return user.role ? [user.role] : [];
}

/** True if ANY of the user's roles grants `perm` (roles union). */
export function userHasPermission(user: RoleBearer | null | undefined, perm: Permission): boolean {
  return rolesOf(user).some((r) => hasPermission(r, perm));
}

/** True if the user holds `role` (among possibly several). */
export function userHasRole(user: RoleBearer | null | undefined, role: Role): boolean {
  return rolesOf(user).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  superuser: 'Super User',
  admin: 'Admin',
  'product-manager': 'Product Manager',
  'employee-manager': 'Employee Manager',
  'customer-manager': 'Customer Manager',
  sales: 'Sales',
  analytics: 'Analytics',
};

export const ALL_ROLES: Role[] = [
  'superuser',
  'admin',
  'product-manager',
  'employee-manager',
  'customer-manager',
  'sales',
  'analytics',
];
