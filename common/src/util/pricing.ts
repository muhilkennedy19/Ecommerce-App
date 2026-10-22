import type { Coupon } from '../types';

export interface CouponResult {
  valid: boolean;
  reason?: string;
  discount: number; // ₹ off the subtotal
  freeDelivery: boolean;
  deliveryFee: number; // effective delivery fee after the coupon
  grandTotal: number;
}

/** Pure evaluation of a coupon against an order subtotal + delivery fee. */
export function evaluateCoupon(
  coupon: Coupon | null | undefined,
  subtotal: number,
  deliveryFee: number,
): CouponResult {
  const none: CouponResult = {
    valid: false,
    discount: 0,
    freeDelivery: false,
    deliveryFee,
    grandTotal: Math.round((subtotal + deliveryFee) * 100) / 100,
  };
  if (!coupon) return { ...none, reason: 'Enter a coupon code.' };
  if (!coupon.active) return { ...none, reason: 'This coupon is not active.' };
  if (coupon.minOrder && subtotal < coupon.minOrder) {
    return { ...none, reason: `Minimum order ₹${coupon.minOrder} required.` };
  }

  let discount = 0;
  if (coupon.discountType === 'flat') discount = coupon.value;
  else if (coupon.discountType === 'percent') {
    discount = (subtotal * coupon.value) / 100;
    if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  }
  discount = Math.min(Math.round(discount * 100) / 100, subtotal); // never exceed subtotal

  const freeDelivery = !!coupon.freeDelivery;
  const effFee = freeDelivery ? 0 : deliveryFee;
  const grandTotal = Math.max(0, Math.round((subtotal - discount + effFee) * 100) / 100);
  return { valid: true, discount, freeDelivery, deliveryFee: effFee, grandTotal };
}
