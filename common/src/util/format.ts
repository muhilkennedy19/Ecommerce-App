import type { OrderStatus, ProductUnit } from '../types';

export const PRODUCT_UNITS: ProductUnit[] = ['kg', 'g', 'litre', 'ml', 'piece'];

export const UNIT_LABELS: Record<ProductUnit, string> = {
  kg: 'Kg',
  g: 'g',
  litre: 'Litre',
  ml: 'ml',
  piece: 'piece',
};

/** "₹120 / Kg" when a unit is set, else "₹120". */
export function formatUnitPrice(price: number, unit?: ProductUnit | null): string {
  return unit ? `₹${price} / ${UNIT_LABELS[unit]}` : `₹${price}`;
}

/**
 * Units priced per whole unit but sellable in fractions — a ₹120/Kg apple can be
 * bought as 300 g. Each maps to a sub-unit with 1000 per base unit.
 */
const SUB_UNITS: Partial<Record<ProductUnit, { label: string; per: number }>> = {
  kg: { label: 'g', per: 1000 },
  litre: { label: 'ml', per: 1000 },
};

export function subUnitOf(unit?: ProductUnit | null): { label: string; per: number } | null {
  return (unit && SUB_UNITS[unit]) || null;
}

/** True when the buyer should be able to pick an arbitrary amount (e.g. 300 g). */
export function isDivisibleUnit(unit?: ProductUnit | null): boolean {
  return subUnitOf(unit) !== null;
}

/** Smallest step a divisible unit can be ordered in, expressed in sub-units. */
export const SUB_UNIT_STEP = 50; // 50 g / 50 ml

/** Quantity in sub-units (300) -> quantity in base units (0.3). */
export function subUnitsToQty(subUnits: number, unit?: ProductUnit | null): number {
  const sub = subUnitOf(unit);
  if (!sub) return subUnits;
  return subUnits / sub.per;
}

/** Quantity in base units (0.3) -> quantity in sub-units (300). */
export function qtyToSubUnits(qty: number, unit?: ProductUnit | null): number {
  const sub = subUnitOf(unit);
  if (!sub) return qty;
  return Math.round(qty * sub.per);
}

/** "300 g", "1.2 Kg", "2" — a human-readable cart/order quantity. */
export function formatQty(qty: number, unit?: ProductUnit | null): string {
  const sub = subUnitOf(unit);
  if (!sub) return unit ? `${trimNum(qty)} ${UNIT_LABELS[unit]}` : trimNum(qty);
  if (qty < 1) return `${Math.round(qty * sub.per)} ${sub.label}`;
  return `${trimNum(qty)} ${UNIT_LABELS[unit as ProductUnit]}`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Round money to paise so float drift never reaches Firestore or a UPI intent. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  out_for_delivery: 'Out for delivery',
  served: 'Served',
  cancelled: 'Cancelled',
};

/** The status a sales rep advances an order to next (null = terminal / no forward step). */
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case 'new':
      return 'accepted';
    case 'accepted':
      return 'out_for_delivery';
    case 'out_for_delivery':
      return 'served';
    default:
      return null;
  }
}

// --------------------------------------------------------------------- Phone
/** Keep digits only, capped at 10 (local mobile number length). */
export function sanitizePhone(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

/** A valid phone number is exactly 10 digits. */
export function isValidPhone(input: string | null | undefined): boolean {
  return /^\d{10}$/.test((input ?? '').trim());
}
