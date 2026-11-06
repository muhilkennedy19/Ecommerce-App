import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPERATING_HOURS,
  describeExpiry,
  discountPercent,
  effectivePrice,
  isShopOpen,
  isStaleToday,
  shopAcceptsOrders,
} from '../src/util/time';
import type { OperatingHours, Shop } from '../src/types';

const ALWAYS_OPEN: OperatingHours = {
  timezone: 'Asia/Kolkata',
  days: {
    sun: { open: '00:00', close: '23:59', closed: false },
    mon: { open: '00:00', close: '23:59', closed: false },
    tue: { open: '00:00', close: '23:59', closed: false },
    wed: { open: '00:00', close: '23:59', closed: false },
    thu: { open: '00:00', close: '23:59', closed: false },
    fri: { open: '00:00', close: '23:59', closed: false },
    sat: { open: '00:00', close: '23:59', closed: false },
  },
};

describe('effectivePrice', () => {
  it('uses the discount price when set', () => {
    expect(effectivePrice({ price: 100, discountPrice: 80 })).toBe(80);
  });

  it('falls back to the list price', () => {
    expect(effectivePrice({ price: 100, discountPrice: null })).toBe(100);
  });

  it('rounds to paise', () => {
    expect(effectivePrice({ price: 10.005, discountPrice: null })).toBe(10.01);
  });
});

describe('discountPercent', () => {
  it('returns null without a discount', () => {
    expect(discountPercent({ price: 100, discountPrice: null })).toBeNull();
  });

  it('computes a whole-number percentage', () => {
    expect(discountPercent({ price: 100, discountPrice: 80 })).toBe(20);
    expect(discountPercent({ price: 250, discountPrice: 200 })).toBe(20);
  });

  it('ignores a discount that is not actually cheaper', () => {
    expect(discountPercent({ price: 100, discountPrice: 100 })).toBeNull();
    expect(discountPercent({ price: 100, discountPrice: 120 })).toBeNull();
  });

  it('ignores nonsense inputs rather than returning Infinity', () => {
    expect(discountPercent({ price: 0, discountPrice: 10 })).toBeNull();
    expect(discountPercent({ price: 100, discountPrice: -5 })).toBeNull();
    expect(discountPercent({ price: Number.NaN, discountPrice: 5 })).toBeNull();
  });
});

describe('isStaleToday', () => {
  const now = new Date('2026-03-15T10:00:00');

  it('treats a missing timestamp as stale', () => {
    expect(isStaleToday(null, now)).toBe(true);
  });

  it('is fresh earlier the same day', () => {
    expect(isStaleToday(new Date('2026-03-15T01:00:00'), now)).toBe(false);
  });

  it('is stale the previous day', () => {
    expect(isStaleToday(new Date('2026-03-14T23:59:00'), now)).toBe(true);
  });

  it('is stale a year earlier on the same date', () => {
    expect(isStaleToday(new Date('2025-03-15T10:00:00'), now)).toBe(true);
  });
});

describe('isShopOpen', () => {
  it('is open inside the window', () => {
    expect(isShopOpen(ALWAYS_OPEN, new Date('2026-03-15T12:00:00'))).toBe(true);
  });

  it('is closed on a day flagged closed', () => {
    const hours: OperatingHours = {
      ...ALWAYS_OPEN,
      days: { ...ALWAYS_OPEN.days, sun: { open: '09:00', close: '18:00', closed: true } },
    };
    // 2026-03-15 is a Sunday.
    expect(isShopOpen(hours, new Date('2026-03-15T12:00:00'))).toBe(false);
  });

  it('is closed before opening time', () => {
    const hours: OperatingHours = {
      ...ALWAYS_OPEN,
      days: { ...ALWAYS_OPEN.days, sun: { open: '09:00', close: '18:00', closed: false } },
    };
    expect(isShopOpen(hours, new Date('2026-03-15T08:00:00'))).toBe(false);
    expect(isShopOpen(hours, new Date('2026-03-15T09:30:00'))).toBe(true);
    expect(isShopOpen(hours, new Date('2026-03-15T19:00:00'))).toBe(false);
  });
});

describe('shopAcceptsOrders', () => {
  const shop = { operatingHours: ALWAYS_OPEN } as Shop;

  it('refuses when there is no shop', () => {
    expect(shopAcceptsOrders(null)).toBe(false);
  });

  it('honours the manual override above the schedule', () => {
    expect(shopAcceptsOrders({ ...shop, forceClosed: true }, new Date('2026-03-15T12:00:00'))).toBe(false);
  });

  it('follows the schedule otherwise', () => {
    expect(shopAcceptsOrders(shop, new Date('2026-03-15T12:00:00'))).toBe(true);
  });
});

describe('describeExpiry', () => {
  const now = new Date('2026-03-15T10:00:00');

  it('flags an elapsed date as expired', () => {
    expect(describeExpiry(new Date('2026-03-14T10:00:00'), now).expired).toBe(true);
  });

  it('does not flag a future date', () => {
    expect(describeExpiry(new Date('2026-03-20T10:00:00'), now).expired).toBe(false);
  });
});

describe('DEFAULT_OPERATING_HOURS', () => {
  it('covers all seven days', () => {
    expect(Object.keys(DEFAULT_OPERATING_HOURS.days)).toHaveLength(7);
  });
});
