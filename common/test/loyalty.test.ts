import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOYALTY,
  isValidReferralCode,
  loyaltyConfig,
  pointsForOrder,
  pointsToRupees,
  quoteRedemption,
  referralCodeFor,
  referralsActive,
  rupeesToPoints,
  settleOrderLoyalty,
} from '../src/util/loyalty';
import type { LoyaltyConfig } from '../src/types';

const ON: LoyaltyConfig = {
  ...DEFAULT_LOYALTY,
  enabled: true,
  referralsEnabled: true,
  earnPerHundred: 2,
  rupeesPerPoint: 1,
  minRedeemPoints: 50,
  maxRedeemPercent: 20,
  referrerBonus: 50,
  refereeBonus: 25,
};

describe('loyaltyConfig', () => {
  it('falls back to defaults when absent', () => {
    expect(loyaltyConfig(null)).toEqual(DEFAULT_LOYALTY);
  });

  it('fills gaps in a partially written config', () => {
    const partial = { enabled: true } as LoyaltyConfig;
    expect(loyaltyConfig(partial).minRedeemPoints).toBe(DEFAULT_LOYALTY.minRedeemPoints);
  });
});

describe('referralsActive', () => {
  it('requires both switches', () => {
    expect(referralsActive({ ...ON, referralsEnabled: false })).toBe(false);
    expect(referralsActive({ ...ON, enabled: false })).toBe(false);
    expect(referralsActive(ON)).toBe(true);
  });
});

describe('pointsForOrder', () => {
  it('earns nothing when disabled', () => {
    expect(pointsForOrder({ ...ON, enabled: false }, { subtotal: 500, total: 500 })).toBe(0);
  });

  it('earns on the amount paid for goods', () => {
    expect(pointsForOrder(ON, { subtotal: 500, total: 500, discount: 0 })).toBe(10);
  });

  it('excludes coupon discounts from the earning base', () => {
    expect(pointsForOrder(ON, { subtotal: 500, total: 500, discount: 100 })).toBe(8);
  });

  it('never returns a fraction of a point', () => {
    expect(pointsForOrder(ON, { subtotal: 149, total: 149 })).toBe(2);
  });

  it('honours the minimum order to earn', () => {
    expect(pointsForOrder({ ...ON, minOrderToEarn: 200 }, { subtotal: 150, total: 150 })).toBe(0);
    expect(pointsForOrder({ ...ON, minOrderToEarn: 200 }, { subtotal: 250, total: 250 })).toBe(5);
  });

  it('never goes negative when a discount exceeds the subtotal', () => {
    expect(pointsForOrder(ON, { subtotal: 100, total: 100, discount: 500 })).toBe(0);
  });
});

describe('pointsToRupees / rupeesToPoints', () => {
  it('round-trips at the configured rate', () => {
    const cfg = { ...ON, rupeesPerPoint: 0.5 };
    expect(pointsToRupees(cfg, 100)).toBe(50);
    expect(rupeesToPoints(cfg, 50)).toBe(100);
  });

  it('rounds points up so the buyer is never under-charged', () => {
    expect(rupeesToPoints({ ...ON, rupeesPerPoint: 3 }, 10)).toBe(4);
  });

  it('is safe when a point is worth nothing', () => {
    expect(rupeesToPoints({ ...ON, rupeesPerPoint: 0 }, 10)).toBe(0);
  });
});

describe('quoteRedemption', () => {
  it('refuses below the minimum balance', () => {
    const q = quoteRedemption(ON, 10, 1000);
    expect(q.points).toBe(0);
    expect(q.reason).toContain('50');
  });

  it('caps at the configured percentage of the order', () => {
    // 20% of ₹500 = ₹100 → 100 points, even though the buyer holds 900.
    const q = quoteRedemption(ON, 900, 500);
    expect(q.points).toBe(100);
    expect(q.rupees).toBe(100);
  });

  it('is limited by the balance when that is the smaller number', () => {
    const q = quoteRedemption(ON, 60, 5000);
    expect(q.points).toBe(60);
  });

  it('never exceeds the cap when a point is worth more than ₹1', () => {
    const q = quoteRedemption({ ...ON, rupeesPerPoint: 3 }, 1000, 500);
    expect(q.rupees).toBeLessThanOrEqual(100);
  });

  it('returns nothing for an empty cart', () => {
    expect(quoteRedemption(ON, 900, 0).points).toBe(0);
  });

  it('returns nothing when loyalty is off', () => {
    expect(quoteRedemption({ ...ON, enabled: false }, 900, 500).points).toBe(0);
  });
});

describe('referralCodeFor', () => {
  it('derives the code from the first six uid characters', () => {
    expect(referralCodeFor('abc123xyz789')).toBe('REFABC123');
  });

  it('matches the expression Security Rules recompute', () => {
    const uid = 'Xy9Lm2QqRsTu';
    expect(referralCodeFor(uid)).toBe('REF' + uid.slice(0, 6).toUpperCase());
  });

  it('accepts its own output as valid', () => {
    expect(isValidReferralCode(referralCodeFor('abc123xyz'))).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidReferralCode('ABC123')).toBe(false);
    expect(isValidReferralCode('REF12')).toBe(false);
    expect(isValidReferralCode('')).toBe(false);
  });
});

describe('settleOrderLoyalty', () => {
  const order = { subtotal: 500, total: 500, discount: 0 };

  it('is a no-op when loyalty is disabled', () => {
    expect(settleOrderLoyalty({ ...ON, enabled: false }, order, null).noop).toBe(true);
  });

  it('is a no-op for an order that already paid out', () => {
    const r = settleOrderLoyalty(ON, { ...order, loyaltyEarned: 10 }, null);
    expect(r.noop).toBe(true);
    expect(r.buyerDelta).toBe(0);
  });

  it('credits the points earned', () => {
    const r = settleOrderLoyalty(ON, order, null);
    expect(r.earned).toBe(10);
    expect(r.buyerDelta).toBe(10);
  });

  it('subtracts points spent on the same order', () => {
    const r = settleOrderLoyalty(ON, { ...order, loyaltyRedeemed: 40 }, null);
    expect(r.redeemed).toBe(40);
    expect(r.buyerDelta).toBe(-30);
  });

  it('pays both sides of a first-order referral', () => {
    const r = settleOrderLoyalty(ON, order, { referredBy: 'REFFRIEND', referralSettled: false });
    expect(r.buyerDelta).toBe(10 + 25);
    expect(r.referrerBonus).toBe(50);
    expect(r.referrerCode).toBe('REFFRIEND');
  });

  it('pays a referral only once', () => {
    const r = settleOrderLoyalty(ON, order, { referredBy: 'REFFRIEND', referralSettled: true });
    expect(r.referrerBonus).toBe(0);
    expect(r.buyerDelta).toBe(10);
  });

  it('skips referral bonuses when referrals are switched off', () => {
    const r = settleOrderLoyalty({ ...ON, referralsEnabled: false }, order, {
      referredBy: 'REFFRIEND',
      referralSettled: false,
    });
    expect(r.referrerBonus).toBe(0);
    expect(r.buyerDelta).toBe(10);
  });
});
