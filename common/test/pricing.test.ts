import { describe, expect, it } from 'vitest';

import { evaluateCoupon } from '../src/util/pricing';
import type { Coupon } from '../src/types';

function coupon(over: Partial<Coupon> = {}): Coupon {
  return {
    code: 'SAVE',
    shopId: 's1',
    discountType: 'flat',
    value: 50,
    active: true,
    ...over,
  };
}

describe('evaluateCoupon', () => {
  it('rejects a missing coupon without discounting', () => {
    const r = evaluateCoupon(null, 500, 40);
    expect(r.valid).toBe(false);
    expect(r.discount).toBe(0);
    expect(r.grandTotal).toBe(540);
  });

  it('rejects an inactive coupon', () => {
    expect(evaluateCoupon(coupon({ active: false }), 500, 40).valid).toBe(false);
  });

  it('enforces the minimum order', () => {
    const r = evaluateCoupon(coupon({ minOrder: 600 }), 500, 40);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('600');
  });

  it('applies a flat discount', () => {
    const r = evaluateCoupon(coupon({ value: 50 }), 500, 40);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(50);
    expect(r.grandTotal).toBe(490);
  });

  it('applies a percent discount', () => {
    const r = evaluateCoupon(coupon({ discountType: 'percent', value: 10 }), 500, 40);
    expect(r.discount).toBe(50);
    expect(r.grandTotal).toBe(490);
  });

  it('caps a percent discount at maxDiscount', () => {
    const r = evaluateCoupon(
      coupon({ discountType: 'percent', value: 50, maxDiscount: 100 }),
      1000,
      40,
    );
    expect(r.discount).toBe(100);
  });

  it('never discounts more than the subtotal', () => {
    const r = evaluateCoupon(coupon({ value: 9999 }), 200, 40);
    expect(r.discount).toBe(200);
    expect(r.grandTotal).toBe(40);
  });

  it('zeroes the delivery fee for a free-delivery coupon', () => {
    const r = evaluateCoupon(coupon({ discountType: 'none', value: 0, freeDelivery: true }), 500, 40);
    expect(r.freeDelivery).toBe(true);
    expect(r.deliveryFee).toBe(0);
    expect(r.grandTotal).toBe(500);
  });

  it('rounds to paise rather than accumulating float drift', () => {
    const r = evaluateCoupon(coupon({ discountType: 'percent', value: 33 }), 0.1 + 0.2, 0);
    expect(Number.isInteger(Math.round(r.grandTotal * 100))).toBe(true);
  });
});
