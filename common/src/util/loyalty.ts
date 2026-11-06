// Loyalty + referral maths. Pure functions only — no Firestore, no clock — so every rule
// here is unit-testable and identical on both apps.
//
// Trust model: points are minted exclusively by the ADMIN app when an order reaches
// `served` (it holds `customers.write`; Security Rules block a buyer from editing their own
// balance). The buyer app only ever *proposes* a redemption, which the seller settles.
import type { Customer, LoyaltyConfig, Order } from '../types';

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  enabled: false,
  referralsEnabled: false,
  earnPerHundred: 2,
  minOrderToEarn: 0,
  rupeesPerPoint: 1,
  minRedeemPoints: 50,
  maxRedeemPercent: 20,
  referrerBonus: 50,
  refereeBonus: 25,
};

/** Fill in any missing field so callers never have to null-check a half-written config. */
export function loyaltyConfig(config?: LoyaltyConfig | null): LoyaltyConfig {
  return config ? { ...DEFAULT_LOYALTY, ...config } : DEFAULT_LOYALTY;
}

/** Referrals require their own switch AND the loyalty master switch (the bonus is points). */
export function referralsActive(config?: LoyaltyConfig | null): boolean {
  const cfg = loyaltyConfig(config);
  return cfg.enabled && cfg.referralsEnabled;
}

function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Points earned on an order. Based on what the buyer actually paid for goods (subtotal less
 * any discount) so coupons and point-redemptions don't also farm new points. Always rounded
 * down — never hand out a fraction of a point.
 */
export function pointsForOrder(config: LoyaltyConfig | null | undefined, order: Pick<Order, 'subtotal' | 'total' | 'discount'>): number {
  const cfg = loyaltyConfig(config);
  if (!cfg.enabled) return 0;
  const base = clampNonNegative((order.subtotal ?? order.total ?? 0) - (order.discount ?? 0));
  if (base < clampNonNegative(cfg.minOrderToEarn)) return 0;
  return Math.floor((base / 100) * clampNonNegative(cfg.earnPerHundred));
}

/** Rupee value of a point balance. */
export function pointsToRupees(config: LoyaltyConfig | null | undefined, points: number): number {
  const cfg = loyaltyConfig(config);
  return Math.round(clampNonNegative(points) * clampNonNegative(cfg.rupeesPerPoint) * 100) / 100;
}

/** Inverse of `pointsToRupees`, rounded up so the buyer is never under-charged in points. */
export function rupeesToPoints(config: LoyaltyConfig | null | undefined, rupees: number): number {
  const cfg = loyaltyConfig(config);
  const per = clampNonNegative(cfg.rupeesPerPoint);
  if (per <= 0) return 0;
  return Math.ceil(clampNonNegative(rupees) / per);
}

export interface RedeemQuote {
  /** Points the buyer may actually spend on this cart. */
  points: number;
  /** ₹ taken off the subtotal by spending them. */
  rupees: number;
  /** Why nothing can be redeemed, when `points` is 0. */
  reason?: string;
}

/**
 * How much of `subtotal` the buyer's balance may cover, honouring the minimum balance and
 * the per-order percentage cap. Returns 0 points (with a reason) rather than throwing.
 */
export function quoteRedemption(
  config: LoyaltyConfig | null | undefined,
  balance: number,
  subtotal: number,
): RedeemQuote {
  const cfg = loyaltyConfig(config);
  if (!cfg.enabled) return { points: 0, rupees: 0, reason: 'Loyalty is not enabled.' };

  const have = Math.floor(clampNonNegative(balance));
  if (have < cfg.minRedeemPoints) {
    return {
      points: 0,
      rupees: 0,
      reason: `Collect ${cfg.minRedeemPoints} points to start redeeming.`,
    };
  }

  const capRupees = (clampNonNegative(subtotal) * clampNonNegative(cfg.maxRedeemPercent)) / 100;
  if (capRupees <= 0) return { points: 0, rupees: 0, reason: 'Cart is empty.' };

  // Floor to points so the ₹ value never exceeds the cap.
  const per = clampNonNegative(cfg.rupeesPerPoint);
  const capPoints = per > 0 ? Math.floor(capRupees / per) : 0;
  const points = Math.min(have, capPoints);
  if (points <= 0) return { points: 0, rupees: 0, reason: 'Order is too small to redeem points.' };
  return { points, rupees: pointsToRupees(cfg, points) };
}

/**
 * The buyer's share code, derived purely from their uid: `REF` + the first six characters,
 * uppercased. Firebase uids are 28 base62 characters, so this always yields `REF` + 6.
 *
 * It is deliberately this simple because Security Rules recompute the SAME expression
 * (`'REF' + request.auth.uid[0:6].upper()`) to verify a self-write — a buyer therefore cannot
 * claim anyone else's code. Do not add character substitutions or hashing here without
 * updating firestore.rules in lockstep.
 */
export function referralCodeFor(uid: string): string {
  return `REF${(uid || '').slice(0, 6).toUpperCase()}`;
}

export function isValidReferralCode(code: string): boolean {
  return /^REF[A-Z0-9]{6}$/.test((code || '').trim().toUpperCase());
}

export interface LoyaltySettlement {
  /** Net change to apply to the buyer's balance (earned − redeemed + joining bonus). */
  buyerDelta: number;
  /** Points earned on this order alone (stamped onto the order for display/audit). */
  earned: number;
  /** Points consumed by this order's redemption. */
  redeemed: number;
  /** Bonus owed to the referrer, if this settles a referral. */
  referrerBonus: number;
  /** `referralCode` of the referrer to credit, when `referrerBonus` > 0. */
  referrerCode?: string | null;
  /** True when nothing needs writing (already settled, loyalty off, etc.). */
  noop: boolean;
}

/**
 * Work out every balance change caused by an order being served. Idempotent by design:
 * an order that already carries `loyaltyEarned` returns `noop`, so a double-tap on
 * "Mark served" can never pay twice.
 */
export function settleOrderLoyalty(
  config: LoyaltyConfig | null | undefined,
  order: Pick<Order, 'subtotal' | 'total' | 'discount' | 'loyaltyEarned' | 'loyaltyRedeemed'>,
  customer: Pick<Customer, 'referredBy' | 'referralSettled'> | null | undefined,
): LoyaltySettlement {
  const cfg = loyaltyConfig(config);
  const none: LoyaltySettlement = {
    buyerDelta: 0,
    earned: 0,
    redeemed: 0,
    referrerBonus: 0,
    referrerCode: null,
    noop: true,
  };
  if (!cfg.enabled) return none;
  if (order.loyaltyEarned != null) return none; // already settled

  const earned = pointsForOrder(cfg, order);
  const redeemed = Math.floor(clampNonNegative(order.loyaltyRedeemed ?? 0));

  // A referral only pays out when the programme is on at settlement time.
  const firstOrderReferral =
    referralsActive(cfg) && !!customer?.referredBy && !customer?.referralSettled;
  const joinBonus = firstOrderReferral ? clampNonNegative(cfg.refereeBonus) : 0;
  const referrerBonus = firstOrderReferral ? clampNonNegative(cfg.referrerBonus) : 0;

  return {
    buyerDelta: earned - redeemed + joinBonus,
    earned,
    redeemed,
    referrerBonus,
    referrerCode: firstOrderReferral ? (customer?.referredBy ?? null) : null,
    noop: earned === 0 && redeemed === 0 && joinBonus === 0 && referrerBonus === 0,
  };
}
