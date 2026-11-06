import type { Timestamp } from 'firebase/firestore';

/** The seven admin-side roles. Enforced in both app navigation and Security Rules. */
export type Role =
  | 'superuser'
  | 'admin'
  | 'product-manager'
  | 'employee-manager'
  | 'customer-manager'
  | 'sales'
  | 'pos'
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

/**
 * A festive overlay the admin can place on top of the buyer logo (splash + home header).
 * One effect covers a pair of related occasions:
 *   fireworks → Diwali · flag → Republic/Independence Day · santa → Christmas/New Year.
 * Absent/`none` = the plain logo.
 */
export type OccasionEffect = 'none' | 'fireworks' | 'flag' | 'santa';

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

/**
 * Shop-wide loyalty + referral settings. Points are minted only by the admin app when an
 * order reaches `served`, so every number here is a seller-controlled policy, never a
 * buyer-supplied one.
 */
export interface LoyaltyConfig {
  /** Master switch for earning + redeeming points. Off = buyers see nothing about loyalty. */
  enabled: boolean;
  /**
   * Referral programme switch, independent of `enabled`. The buyer app only reveals the
   * "invite a friend" card and the referral-code box when this is on.
   */
  referralsEnabled: boolean;
  /** Points earned per ₹100 of order value (e.g. 5 → ₹500 order earns 25 points). */
  earnPerHundred: number;
  /** Orders below this subtotal (₹) earn nothing. 0 = every order earns. */
  minOrderToEarn: number;
  /** Rupee value of one point when redeemed (e.g. 1 → 100 points = ₹100 off). */
  rupeesPerPoint: number;
  /** Buyer must hold at least this many points before redeeming anything. */
  minRedeemPoints: number;
  /** Hard cap on how much of an order's subtotal points may cover, 0–100. */
  maxRedeemPercent: number;
  /** One-off bonus to the referrer when their invitee's first order is served. */
  referrerBonus: number;
  /** One-off bonus to the new buyer when their first order is served. */
  refereeBonus: number;
}

export interface Shop {
  id: string;
  name: string;
  /** Global sale discount applied on top of products, 0–100. */
  salesDiscountPercent: number;
  /**
   * Minimum cart subtotal (₹) required to start a product subscription. Subscriptions are
   * cart-based and delivered free, so a floor avoids uneconomical tiny standing orders.
   * 0/absent = subscriptions disabled.
   */
  subscriptionMinOrder?: number | null;
  /**
   * Minimum distance (metres) a courier device must move before it writes a new location to
   * the order it is delivering. Throttles live-tracking writes to keep Firestore cheap.
   * Superuser-tunable (Notifications screen). Absent/null ⇒ `DEFAULT_COURIER_MIN_MOVE_METERS`.
   */
  courierMinMoveMeters?: number | null;
  /**
   * Radius (metres) within which a delivering courier is treated as "arrived" at the buyer's
   * address, firing the one-time doorstep push. Superuser-tunable (Notifications screen).
   * Absent/null ⇒ `DEFAULT_ARRIVAL_RADIUS_METERS`.
   */
  arrivalRadiusMeters?: number | null;
  operatingHours: OperatingHours;
  /** When true, the shop is closed regardless of the schedule (manual override). */
  forceClosed?: boolean;
  /** Receiver UPI VPA for buyer UPI payments (e.g. "shop@okicici"). */
  upiVpa?: string | null;
  upiPayeeName?: string | null;
  /** `images/{id}` holding the shop logo shown on the buyer launch screen. */
  logoImageId?: string | null;
  /** Festive overlay drawn on top of the buyer logo (splash + home header). */
  iconEffect?: OccasionEffect | null;
  /** Short tagline shown under the shop name on the buyer Contact Us screen. */
  tagline?: string | null;
  /** Full postal address (free-form, multi-line) shown on Contact Us. */
  address?: string | null;
  /** Primary / secondary contact numbers (buyers can tap to call). */
  contactPhone1?: string | null;
  contactPhone2?: string | null;
  /** Contact email (buyers can tap to compose). */
  contactEmail?: string | null;
  /** Shop location pin (WGS84); lets buyers open directions in their maps app. */
  lat?: number | null;
  lng?: number | null;
  /** Loyalty + referral policy. Absent = loyalty disabled. */
  loyalty?: LoyaltyConfig | null;
  /**
   * Public Play Store listing for the BUYER app, set once it is published. Appended to the
   * referral share message so an invited friend can install it; absent = share the code only.
   */
  playStoreUrl?: string | null;
  /** Printed on invoices when set (e.g. "29ABCDE1234F1Z5"). */
  gstin?: string | null;
  /** Running counter behind `Order.invoiceNo`; incremented transactionally. */
  invoiceSeq?: number | null;
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

/** A scanned inventory barcode and the on-hand quantity counted against it. */
export interface Barcode {
  code: string;
  qty: number;
}
export interface PrepTime {
  value: number;
  unit: PrepUnit;
}

/**
 * Hard cap on the buyer home "Featured" row. The row is a non-virtualised horizontal
 * ScrollView, so every extra card is an eagerly-mounted image — keep it small.
 */
export const MAX_FEATURED_PRODUCTS = 10;

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
  /**
   * Tiny inline preview (a complete `data:image/jpeg;base64,...` URI, a few KB) stored on the
   * product doc itself. Lists render this; the full `imageId` blob is fetched only when a
   * detail/edit screen actually needs it. Keeps a 500-SKU catalogue cheap to paint.
   */
  thumb?: string | null;
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
  /**
   * Stock level at/below which the item is flagged as running low (admin dashboard badge +
   * daily alert). Only meaningful when `trackStock` is on. Absent/null = no alerting.
   */
  reorderLevel?: number | null;

  /**
   * Fixed-quantity (packaged) item: even for a divisible unit (kg/litre), buyer/POS may only
   * pick whole counts — no custom weight entry. Default (false/absent) keeps divisible units
   * weighable. Non-divisible units (piece) are always whole counts regardless.
   */
  fixedQty?: boolean | null;

  /**
   * Optional barcode-based inventory. When a product has ≥1 barcode, its `stock` is the sum
   * of these quantities and `trackStock` is forced on. Products without barcodes keep using
   * the manual `stock`/`trackStock` fields as before.
   */
  barcodes?: Barcode[] | null;

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
  /** Delivery pin dropped by the buyer (WGS84). Lets the seller navigate to the exact spot. */
  lat?: number | null;
  lng?: number | null;
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

  /**
   * Loyalty wallet balance in points. Written ONLY by the admin app (which holds
   * `customers.write`) when an order is served — Security Rules forbid a buyer from
   * changing their own balance, otherwise points would be free to mint.
   */
  loyaltyPoints?: number;
  /** Stable share code this buyer hands to friends (uppercase, derived from their uid). */
  referralCode?: string | null;
  /** `referralCode` of the buyer who referred this one. Set once, at sign-up/first order. */
  referredBy?: string | null;
  /** True once the referral bonus has been paid out, so it can never be granted twice. */
  referralSettled?: boolean;
  /** How many friends this buyer has successfully referred (for display). */
  referralCount?: number;

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

export type OrderStatus = 'new' | 'accepted' | 'packed' | 'out_for_delivery' | 'served' | 'cancelled';

/** How the order is paid. UPI is a deep-link flow reconciled manually (not auto-verified). */
export type PaymentMode = 'cod' | 'upi' | 'cash' | 'card';
/** pending → (buyer taps paid) claimed → (admin reconciles) verified. COD stays pending until served. */
export type PaymentStatus = 'pending' | 'claimed' | 'verified';

export interface OrderItem {
  productId: string;
  name: string;
  price: number; // unit price charged at order time
  /** Amount in the product's unit; fractional for divisible units (0.3 = 300 g). */
  qty: number;
  /** Selling unit at order time, so the quantity can be rendered as "300 g". */
  unit?: ProductUnit | null;
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
  /**
   * Public, human-friendly order code (e.g. `mkenK7P3Q2`), shown to buyers and sellers as the
   * "Order ID". Random; the Firestore doc `id` remains the internal key. Absent on orders
   * created before codes existed (display falls back to a slice of `id`).
   */
  orderCode?: string | null;
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
  /** Sales channel: online buyer order (default) or an in-store POS sale. */
  channel?: 'online' | 'pos' | null;
  paymentStatus?: PaymentStatus;
  upiRef?: string | null; // buyer-provided UPI reference, if any
  address?: Address | null; // snapshot at order time
  pincode?: string | null;
  status: OrderStatus;
  /**
   * Set by the sales/delivery person when an in-progress order is running behind schedule.
   * Buyers see a "Running late" badge instead of the default "On time". Only meaningful while
   * the order is `accepted`/`out_for_delivery`; absent/false = on time.
   */
  runningLate?: boolean;
  /**
   * Live courier tracking. When an order goes `out_for_delivery`, the staff member who did it
   * becomes the courier (`courierId`/`courierName`) and their device streams its position here
   * (`courierLat`/`courierLng`, with `courierUpdatedAt` an epoch-ms client stamp). The buyer's
   * track-on-map screen reads these live. Absent until a first fix is written; writes are
   * throttled by `Shop.courierMinMoveMeters`.
   */
  courierId?: string | null;
  courierName?: string | null;
  courierLat?: number | null;
  courierLng?: number | null;
  courierUpdatedAt?: number | null;
  /**
   * Epoch-ms stamp set once, by the courier device, when it first comes within the shop's
   * arrival radius of the delivery address — its presence is the idempotency marker that stops
   * the "reaching your doorstep" push firing more than once.
   */
  arrivalNotifiedAt?: number | null;
  /** True once stock was decremented for this order (on accept); drives restock-on-cancel. */
  stockApplied?: boolean;
  assignedTo?: string | null; // employee uid who picked up the order
  note?: string | null;
  changeLog?: OrderChange[];
  /** Full audit trail of status transitions (who did what, when) — shown to admins. */
  statusLog?: OrderStatusEntry[];
  /** Net change to grandTotal since the buyer placed it (+ pay more / − refund). */
  amountDelta?: number;
  /**
   * Loyalty points granted for this order. Stamped by the admin app when the order is
   * served; its presence is what stops the same order paying out twice.
   */
  loyaltyEarned?: number;
  /** Loyalty points the buyer spent on this order (already reflected in `discount`). */
  loyaltyRedeemed?: number;
  /** Sequential human-readable bill number, assigned on first invoice generation. */
  invoiceNo?: string | null;
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

/**
 * A product rating + optional written review. doc id = `${productId}_${uid}` so a buyer has
 * exactly one (editable) review per product. Purchase-verification is enforced client-side
 * (the form only shows if the buyer has ordered the product); Rules enforce ownership.
 */
export interface Review {
  id: string;
  productId: string;
  shopId: string;
  uid: string;
  customerName?: string | null;
  /** 1–5 stars. */
  rating: number;
  text?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * A buyer's rating of the DELIVERY experience for one served order (one per order, doc id =
 * orderId). Kept separate from product reviews so it can feed later sentiment analysis.
 */
export interface DeliveryFeedback {
  id: string; // = orderId
  orderId: string;
  shopId: string;
  uid: string;
  customerName?: string | null;
  /** 1–5 stars. */
  rating: number;
  text?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
export type SubscriptionMode = 'once' | 'recurring';
export type SubscriptionFrequency = 'daily' | 'weekly';

/**
 * A buyer's scheduled/standing order for a single product. The notify Worker cron
 * materializes a fresh `new` order whenever `nextRunAt` comes due, then advances it
 * (one-time → deactivates; recurring → rolls `nextRunAt` forward).
 */
export interface Subscription {
  id: string;
  shopId: string;
  customerId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  /** The subscribed cart: one or more products. Snapshotted at creation time. */
  items: OrderItem[];
  /** Items total (₹) at creation — the order the Worker creates is delivered free of charge. */
  subtotal: number;
  /** Delivery snapshot. */
  address?: Address | null;
  pincode?: string | null;
  paymentMode: 'cod' | 'upi';
  note?: string | null;
  mode: SubscriptionMode;
  /** "HH:MM" local time — informational; the schedule is driven by the absolute `nextRunAt`. */
  time: string;
  frequency?: SubscriptionFrequency | null; // recurring only
  weekdays?: Weekday[] | null; // recurring + weekly only
  date?: string | null; // once only, "YYYY-MM-DD"
  active: boolean;
  /** Absolute next fire time, computed ON DEVICE (local→UTC) so the Worker needs no tz math. */
  nextRunAt: Timestamp;
  lastRunAt?: Timestamp | null;
  createdAt?: Timestamp;
}

/** A shop announcement broadcast to buyers (push + a dismissible card on the buyer Home). */
export interface Announcement {
  id: string;
  shopId: string;
  title: string;
  body: string;
  /** `images/{id}` holding an optional banner image. */
  imageId?: string | null;
  /** Optional product this announcement links to (buyer taps through to it). */
  productId?: string | null;
  active: boolean;
  /**
   * When this banner stops showing on the buyer Home (buyers filter it out past this).
   * Set from the admin's chosen TTL at creation; absent on legacy docs, which fall back to
   * `createdAt + DEFAULT_ANNOUNCEMENT_TTL_HOURS`. See `isAnnouncementLive`.
   */
  expiresAt?: Timestamp | null;
  createdBy?: string | null;
  createdAt?: Timestamp;
}
