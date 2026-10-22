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
