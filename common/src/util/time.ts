import type { OperatingHours, PrepTime, Product, Shop, Weekday } from '../types';

const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Whether the shop is currently accepting orders.
 * NOTE: comparison uses the device's local time. The stored `timezone` is
 * informational for now; proper cross-timezone handling is a later upgrade.
 */
export function isShopOpen(hours: OperatingHours | undefined | null, now: Date = new Date()): boolean {
  if (!hours) return true; // no config → treat as always open
  const day = hours.days[WEEKDAY_BY_INDEX[now.getDay()]];
  if (!day || day.closed) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close === open) return true; // open == close → treated as open-ended / 24h
  if (close < open) return cur >= open || cur < close; // overnight (wraps past midnight)
  return cur >= open && cur < close;
}

/** Human "use by ~N hours/days from now" hint, or expired. */
export function describeExpiry(
  expiresAt: Date,
  now: Date = new Date(),
): { expired: boolean; text: string } {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return { expired: true, text: 'Expired' };
  const hours = ms / 3_600_000;
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return { expired: false, text: `Use by ~${h} hour${h === 1 ? '' : 's'} from now` };
  }
  const d = Math.round(hours / 24);
  return { expired: false, text: `Use by ~${d} day${d === 1 ? '' : 's'} from now` };
}

/** "Made on demand · ready in ~4 hours" */
export function describePrep(prep: PrepTime): string {
  return `Made on demand · ready in ~${prep.value} ${prep.unit}`;
}

/** Whether the shop is accepting orders: honours the manual force-close override, then the schedule. */
export function shopAcceptsOrders(shop: Shop | null | undefined, now: Date = new Date()): boolean {
  if (!shop) return false;
  if (shop.forceClosed) return false;
  return isShopOpen(shop.operatingHours, now);
}

/**
 * The per-unit price a buyer pays = the product's own discount (if any). The store-wide
 * discount was removed in favour of checkout coupons, so `shop` is accepted only for
 * backward-compatibility and is ignored.
 */
export function effectivePrice(
  product: Pick<Product, 'price' | 'discountPrice'>,
  _shop?: unknown,
): number {
  const base = product.discountPrice ?? product.price;
  return Math.round(base * 100) / 100;
}

/** True if the timestamp is not from the current local calendar day (drives daily reminders). */
export function isStaleToday(updatedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!updatedAt) return true;
  return (
    updatedAt.getFullYear() !== now.getFullYear() ||
    updatedAt.getMonth() !== now.getMonth() ||
    updatedAt.getDate() !== now.getDate()
  );
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  timezone: 'Asia/Kolkata',
  days: {
    sun: { open: '09:00', close: '18:00', closed: false },
    mon: { open: '09:00', close: '18:00', closed: false },
    tue: { open: '09:00', close: '18:00', closed: false },
    wed: { open: '09:00', close: '18:00', closed: false },
    thu: { open: '09:00', close: '18:00', closed: false },
    fri: { open: '09:00', close: '18:00', closed: false },
    sat: { open: '09:00', close: '18:00', closed: false },
  },
};
