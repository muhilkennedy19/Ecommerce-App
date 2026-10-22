import type { Timestamp } from 'firebase/firestore';

/** The seven admin-side roles. Enforced in both app navigation and Security Rules. */
export type Role =
  | 'superuser'
  | 'admin'
  | 'product-manager'
  | 'employee-manager'
  | 'customer-manager'
  | 'sales'
  | 'analytics';

/** An admin/seller-side identity. `users/{uid}` is the source of truth for role checks. */
export interface AppUser {
  uid: string;
  email: string;
  name: string;
  /** Primary role (kept for back-compat & display). For permission checks prefer `roles`. */
  role: Role;
  /** All roles granted to this user (union of permissions). Falls back to `[role]` when absent. */
  roles?: Role[];
  shopId: string;
  active: boolean;
  createdAt?: Timestamp;
}

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/** Open/close times are "HH:MM" (24h) in the shop's timezone. */
export interface OperatingDay {
  open: string;
  close: string;
  closed: boolean;
}

export interface OperatingHours {
  timezone: string; // IANA name, informational; comparisons use device local time (see util/time)
  days: Record<Weekday, OperatingDay>;
}

export interface Shop {
  id: string;
  name: string;
  /** Global sale discount applied on top of products, 0–100. */
  salesDiscountPercent: number;
  operatingHours: OperatingHours;
  /** When true, the shop is closed regardless of the schedule (manual override). */
  forceClosed?: boolean;
  /** Receiver UPI VPA for buyer UPI payments (e.g. "shop@okicici"). */
  upiVpa?: string | null;
  upiPayeeName?: string | null;
  createdAt?: Timestamp;
}

export interface Category {
  id: string;
  shopId: string;
  name: string;
  order: number;
}

export type PrepUnit = 'hours' | 'days';
export type ProductUnit = 'kg' | 'g' | 'litre' | 'ml' | 'piece';
export interface PrepTime {
  value: number;
  unit: PrepUnit;
}

export interface Product {
  id: string;
  shopId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  discountPrice?: number | null;
  /** Optional selling unit; when set the buyer sees "₹X / Kg" etc. */
  unit?: ProductUnit | null;
  /** Id of an `images/{id}` doc holding the base64 image (Spark-friendly, no Cloud Storage). */
  imageId?: string | null;
  active: boolean;

  /** Highlighted on the buyer home "Featured" row. */
  featured?: boolean;

  /** Perishable items trigger the daily price-update reminder. */
  perishable: boolean;
  priceUpdatedAt?: Timestamp | null;

  /** Optional "use by" date; buyer app renders a relative hint. */
  expiresAt?: Timestamp | null;

  /** When false, the item always shows as available (shopkeeper sources it on order). */
  trackStock: boolean;
  stock?: number | null;
  stockUpdatedAt?: Timestamp | null;

  /** Made-to-order items (e.g. a garland); buyer sees the prep lead time. */
  onDemand: boolean;
  prepTime?: PrepTime | null;

  createdAt?: Timestamp;
}

export type EmployeeStatus = 'invited' | 'active' | 'disabled';

export interface Employee {
  id: string;
  shopId: string;
  name: string;
  email: string;
  dob?: string | null; // ISO yyyy-mm-dd
  address?: string | null;
  proofImageId?: string | null;
  photoImageId?: string | null;
  status: EmployeeStatus;
  onboardingToken?: string | null;
  uid?: string | null;
  createdAt?: Timestamp;
}

/** A buyer delivery address. `pincode` drives serviceability + delivery-fee lookup. */
export interface Address {
  id: string;
  label?: string | null; // e.g. "Home", "Work"
  door: string;
  street: string;
  city: string;
  pincode: string;
  landmark?: string | null;
}

export interface Customer {
  id: string;
  shopId: string;
  name: string;
  email: string;
  phone?: string | null;
  addresses?: Address[];
  defaultAddressId?: string | null;
  /** @deprecated legacy single-line address; superseded by `addresses`. */
  address?: string | null;
  /** productIds the buyer wants a back-in-stock alert for. */
  notifyBackInStock?: string[];
  locale?: string | null;
  uid?: string | null;
  createdAt?: Timestamp;
}

/** Admin-managed delivery zone, keyed by pincode (doc id = pincode). */
export interface DeliveryZone {
  pincode: string;
  serviceable: boolean;
  deliveryFee: number;
  /** Order subtotal at/above which delivery is free. */
  freeAbove: number;
}

export type OrderStatus = 'new' | 'accepted' | 'out_for_delivery' | 'served' | 'cancelled';

/** How the order is paid. UPI is a deep-link flow reconciled manually (not auto-verified). */
export type PaymentMode = 'cod' | 'upi';
/** pending → (buyer taps paid) claimed → (admin reconciles) verified. COD stays pending until served. */
export type PaymentStatus = 'pending' | 'claimed' | 'verified';

export interface OrderItem {
  productId: string;
  name: string;
  price: number; // unit price charged at order time
  qty: number;
}

/** An entry in an order's audit trail (e.g. a sales rep adjusting items). */
export interface OrderChange {
  at: number; // epoch ms (client clock; set when the change is made)
  by: string; // uid
  type: 'edit' | 'status';
  note: string;
  delta?: number; // total change in currency (+ customer pays more, − refund)
}

/** A status transition in an order's lifecycle — who moved it where, and when. */
export interface OrderStatusEntry {
  at: number; // epoch ms
  by: string; // uid of the actor (customer on placement, employee otherwise)
  byName?: string | null; // display name of the actor
  status: OrderStatus;
}

export interface Order {
  id: string;
  shopId: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string | null; // snapshot so sellers can contact the buyer
  items: OrderItem[];
  /** Items total (pre-delivery). `total` is kept as an alias of subtotal for back-compat. */
  subtotal?: number;
  total: number;
  deliveryFee?: number;
  couponCode?: string | null;
  discount?: number; // coupon discount applied (₹)
  grandTotal?: number;
  paymentMode?: PaymentMode;
  paymentStatus?: PaymentStatus;
  upiRef?: string | null; // buyer-provided UPI reference, if any
  address?: Address | null; // snapshot at order time
  pincode?: string | null;
  status: OrderStatus;
  /** True once stock was decremented for this order (on accept); drives restock-on-cancel. */
  stockApplied?: boolean;
  assignedTo?: string | null; // employee uid who picked up the order
  note?: string | null;
  changeLog?: OrderChange[];
  /** Full audit trail of status transitions (who did what, when) — shown to admins. */
  statusLog?: OrderStatusEntry[];
  /** Net change to grandTotal since the buyer placed it (+ pay more / − refund). */
  amountDelta?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Push token registry (doc id = uid); owner-writable, kept out of the users doc. */
export interface PushToken {
  token: string;
  kind: 'admin' | 'buyer';
  /** Primary role of the owner, mirrored here for server-side recipient targeting. */
  role?: string | null;
  /** All roles of the owner (admin devices), used by the notify server for targeting. */
  roles?: string[];
  /** Per-user order-notification switch. Absent/true = on; false = the user opted out. */
  notify?: boolean;
  updatedAt?: Timestamp;
}

export type CouponDiscountType = 'flat' | 'percent' | 'none';

/** A discount/free-delivery coupon (doc id = uppercased code). */
export interface Coupon {
  code: string;
  shopId: string;
  /** 'flat' = ₹ off, 'percent' = % off (capped by maxDiscount), 'none' = free-delivery-only. */
  discountType: CouponDiscountType;
  value: number;
  /** Cap in ₹ for percent coupons. */
  maxDiscount?: number | null;
  freeDelivery?: boolean;
  /** Minimum order subtotal (₹) required to use the coupon. */
  minOrder?: number | null;
  active: boolean;
  /** Surface this code to all buyers in the checkout coupons box. */
  showByDefault?: boolean;
  createdAt?: Timestamp;
}

/**
 * A signed-in admin-app user who has no role yet. Self-created on first sign-in so a
 * role-manager can grant them a role in-app (doc id = uid). Carries NO role — granting a
 * role happens only via the `users` collection, gated by rules.
 */
export interface PendingUser {
  uid: string;
  email: string;
  name: string;
  requestedAt?: Timestamp;
}
