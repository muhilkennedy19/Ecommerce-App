import type { Announcement } from '../types';

/** Default lifetime of a broadcast banner when the admin doesn't pick one. */
export const DEFAULT_ANNOUNCEMENT_TTL_HOURS = 24;

const HOUR_MS = 3_600_000;

/**
 * Effective expiry (epoch ms) of an announcement banner. Prefers the explicit `expiresAt`;
 * falls back to `createdAt + DEFAULT_ANNOUNCEMENT_TTL_HOURS` so legacy banners written before
 * TTLs existed also age out (a week-old test broadcast is long expired). Only a banner with
 * neither timestamp is treated as non-expiring.
 */
export function announcementExpiresAtMs(
  a: Pick<Announcement, 'expiresAt' | 'createdAt'>,
): number {
  if (a.expiresAt) return a.expiresAt.toMillis();
  const created = a.createdAt?.toMillis();
  return created != null ? created + DEFAULT_ANNOUNCEMENT_TTL_HOURS * HOUR_MS : Number.POSITIVE_INFINITY;
}

/** Whether an announcement banner is still within its lifetime at `nowMs`. */
export function isAnnouncementLive(
  a: Pick<Announcement, 'expiresAt' | 'createdAt'>,
  nowMs: number,
): boolean {
  return announcementExpiresAtMs(a) > nowMs;
}
