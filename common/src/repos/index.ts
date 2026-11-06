import {
  addDoc,
  arrayUnion,
  collection,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  sum,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type UpdateData,
} from 'firebase/firestore';
import { getDb } from '../firebase/client';
import type {
  Address,
  Announcement,
  AppUser,
  Category,
  Coupon,
  Customer,
  DeliveryZone,
  DeliveryFeedback,
  Employee,
  Order,
  OrderChange,
  OrderItem,
  OrderStatus,
  PaymentMode,
  PendingUser,
  Product,
  PushToken,
  Review,
  Role,
  Shop,
  Subscription,
} from '../types';
import { DEFAULT_OPERATING_HOURS } from '../util/time';
import { settleOrderLoyalty } from '../util/loyalty';
import { DEFAULT_ANNOUNCEMENT_TTL_HOURS } from '../util/announce';
import { makeOrderCode } from '../util/ordercode';

function withId<T>(id: string, data: Record<string, unknown>): T & { id: string } {
  return { id, ...(data as T) } as T & { id: string };
}

// ----------------------------------------------------------------------------- Shop
export async function getShop(shopId: string): Promise<Shop | null> {
  const s = await getDoc(doc(getDb(), 'shops', shopId));
  return s.exists() ? withId<Shop>(s.id, s.data()) : null;
}

export function subscribeShop(shopId: string, cb: (shop: Shop | null) => void): Unsubscribe {
  return onSnapshot(doc(getDb(), 'shops', shopId), (s) =>
    cb(s.exists() ? withId<Shop>(s.id, s.data()) : null),
  );
}

export async function updateShop(shopId: string, patch: Partial<Shop>): Promise<void> {
  await setDoc(doc(getDb(), 'shops', shopId), patch, { merge: true });
}

export async function ensureShop(shopId: string, name: string): Promise<void> {
  const ref = doc(getDb(), 'shops', shopId);
  if (!(await getDoc(ref)).exists()) {
    await setDoc(ref, {
      name,
      salesDiscountPercent: 0,
      operatingHours: DEFAULT_OPERATING_HOURS,
      createdAt: serverTimestamp(),
    });
  }
}

// ----------------------------------------------------------------------- Categories
export function subscribeCategories(shopId: string, cb: (c: Category[]) => void): Unsubscribe {
  const q = query(
    collection(getDb(), 'categories'),
    where('shopId', '==', shopId),
    orderBy('order', 'asc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Category>(d.id, d.data()))));
}

export async function addCategory(shopId: string, name: string, order = 0): Promise<string> {
  const r = await addDoc(collection(getDb(), 'categories'), { shopId, name, order });
  return r.id;
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  await updateDoc(doc(getDb(), 'categories', id), patch as UpdateData<Category>);
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'categories', id));
}

// ------------------------------------------------------------------------- Products
export type ProductDraft = Omit<Product, 'id' | 'createdAt'>;

export function subscribeProducts(
  shopId: string,
  cb: (p: Product[]) => void,
  categoryId?: string,
): Unsubscribe {
  const cons: QueryConstraint[] = [where('shopId', '==', shopId)];
  if (categoryId) cons.push(where('categoryId', '==', categoryId));
  cons.push(orderBy('name', 'asc'));
  const q = query(collection(getDb(), 'products'), ...cons);
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Product>(d.id, d.data()))));
}

export async function addProduct(draft: ProductDraft): Promise<string> {
  const r = await addDoc(collection(getDb(), 'products'), {
    ...draft,
    createdAt: serverTimestamp(),
  });
  return r.id;
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<void> {
  await updateDoc(doc(getDb(), 'products', id), patch as UpdateData<Product>);
}

export async function deleteProduct(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'products', id));
}

/** Update price and stamp `priceUpdatedAt` (clears the daily perishable reminder). */
export async function touchProductPrice(
  id: string,
  price: number,
  discountPrice?: number | null,
): Promise<void> {
  await updateDoc(doc(getDb(), 'products', id), {
    price,
    discountPrice: discountPrice ?? null,
    priceUpdatedAt: serverTimestamp(),
  });
}

/** Update stock and stamp `stockUpdatedAt` (clears the daily stock reminder). */
export async function touchProductStock(id: string, stock: number): Promise<void> {
  await updateDoc(doc(getDb(), 'products', id), { stock, stockUpdatedAt: serverTimestamp() });
}

// ------------------------------------------------------------------------ Employees
export function subscribeEmployees(shopId: string, cb: (e: Employee[]) => void): Unsubscribe {
  const q = query(
    collection(getDb(), 'employees'),
    where('shopId', '==', shopId),
    orderBy('name', 'asc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Employee>(d.id, d.data()))));
}

/** Create an invited employee record + onboarding token (email delivery is stubbed on Spark). */
export async function inviteEmployee(
  shopId: string,
  name: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const r = await addDoc(collection(getDb(), 'employees'), {
    shopId,
    name,
    email,
    status: 'invited',
    onboardingToken: token,
    createdAt: serverTimestamp(),
  });
  return { id: r.id, token };
}

export async function updateEmployee(id: string, patch: Partial<Employee>): Promise<void> {
  await updateDoc(doc(getDb(), 'employees', id), patch as UpdateData<Employee>);
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const s = await getDoc(doc(getDb(), 'employees', id));
  return s.exists() ? withId<Employee>(s.id, s.data()) : null;
}

// ------------------------------------------------------------------------ Customers
export function subscribeCustomers(shopId: string, cb: (c: Customer[]) => void): Unsubscribe {
  const q = query(
    collection(getDb(), 'customers'),
    where('shopId', '==', shopId),
    orderBy('name', 'asc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Customer>(d.id, d.data()))));
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const s = await getDoc(doc(getDb(), 'customers', id));
  return s.exists() ? withId<Customer>(s.id, s.data()) : null;
}

/**
 * Buyer self-service: the customer doc id is the user's uid. Returns `{ isNew }` so the
 * caller can fire a one-time welcome email only on the customer's very first sign-in.
 */
export async function upsertCustomerForUser(
  shopId: string,
  uid: string,
  data: Partial<Customer>,
): Promise<{ isNew: boolean }> {
  const ref = doc(getDb(), 'customers', uid);
  const existing = await getDoc(ref);
  const isNew = !existing.exists();
  await setDoc(ref, { shopId, uid, ...data }, { merge: true });
  return { isNew };
}

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', id), patch as UpdateData<Customer>);
}

// --------------------------------------------------------------- Loyalty & referrals
/** Resolve a referral code to the customer who owns it (null when it matches nobody). */
export async function findCustomerByReferralCode(
  shopId: string,
  code: string,
): Promise<Customer | null> {
  const clean = (code || '').trim().toUpperCase();
  if (!clean) return null;
  const snap = await getDocs(
    query(
      collection(getDb(), 'customers'),
      where('shopId', '==', shopId),
      where('referralCode', '==', clean),
      limit(1),
    ),
  );
  const d = snap.docs[0];
  return d ? withId<Customer>(d.id, d.data()) : null;
}

/**
 * Add (or subtract) loyalty points atomically. Runs in a transaction rather than using
 * `increment()` so the balance can never be pushed below zero by a concurrent redemption.
 * Admin-only: Security Rules reject a buyer writing their own `loyaltyPoints`.
 */
export async function creditLoyaltyPoints(
  customerId: string,
  delta: number,
  extra?: Partial<Customer>,
): Promise<number> {
  const ref = doc(getDb(), 'customers', customerId);
  return runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Customer not found');
    const current = Number((snap.data() as Customer).loyaltyPoints ?? 0);
    const next = Math.max(0, Math.round(current + delta));
    tx.update(ref, { ...extra, loyaltyPoints: next } as UpdateData<Customer>);
    return next;
  });
}

/**
 * Stamp the points an order earned/consumed onto the order itself. Written separately from
 * the balance update so `loyaltyEarned` acts as the idempotency marker — see
 * `settleOrderLoyalty` in util/loyalty.
 */
export async function markOrderLoyaltySettled(
  orderId: string,
  earned: number,
  redeemed: number,
): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', orderId), {
    loyaltyEarned: earned,
    loyaltyRedeemed: redeemed,
    updatedAt: serverTimestamp(),
  } as UpdateData<Order>);
}

/**
 * Pay out an order's loyalty: credit the buyer, settle any pending referral, and stamp the
 * order so it can never pay twice. Admin-side only (needs `customers.write`); call it right
 * after an order is marked served. Returns the points the buyer earned.
 *
 * Deliberately total-failure-tolerant at the call site: loyalty is a reward, never a reason
 * to block fulfilment, so callers should treat a rejection as a no-op.
 */
export async function settleLoyaltyForOrder(shopId: string, order: Order): Promise<number> {
  if (order.loyaltyEarned != null) return 0; // already settled
  if (order.channel === 'pos') return 0; // walk-in sale, no buyer account to credit

  const [shop, customer] = await Promise.all([getShop(shopId), getCustomer(order.customerId)]);
  if (!customer) return 0;

  const plan = settleOrderLoyalty(shop?.loyalty, order, customer);
  if (plan.noop && !plan.referrerCode) return 0;

  // Settling the referral and the balance together keeps them consistent for this buyer.
  await creditLoyaltyPoints(
    order.customerId,
    plan.buyerDelta,
    plan.referrerCode ? { referralSettled: true } : undefined,
  );
  await markOrderLoyaltySettled(order.id, plan.earned, plan.redeemed);

  if (plan.referrerCode && plan.referrerBonus > 0) {
    const referrer = await findCustomerByReferralCode(shopId, plan.referrerCode);
    // A stale/unknown code simply earns nobody anything — the buyer's side is already done.
    if (referrer && referrer.id !== order.customerId) {
      await creditLoyaltyPoints(referrer.id, plan.referrerBonus, {
        referralCount: (referrer.referralCount ?? 0) + 1,
      });
    }
  }
  return plan.earned;
}

// --------------------------------------------------------------------------- Orders
/**
 * Live feed of the most recent orders. `max` is deliberately required-by-default (25):
 * an unbounded listener re-downloads and re-renders the shop's ENTIRE order history on
 * every write, which stops being viable within weeks of going live. Older orders are
 * loaded on demand through `fetchOrdersPage`.
 */
export function subscribeOrders(
  shopId: string,
  cb: (o: Order[]) => void,
  status?: OrderStatus,
  max = 25,
): Unsubscribe {
  const cons: QueryConstraint[] = [where('shopId', '==', shopId)];
  if (status) cons.push(where('status', '==', status));
  cons.push(orderBy('createdAt', 'desc'), limit(max));
  const q = query(collection(getDb(), 'orders'), ...cons);
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Order>(d.id, d.data()))));
}

/** One page of shop orders, newest-first. Pass the previous page's `cursor` to continue. */
export async function fetchOrdersPage(
  shopId: string,
  pageSize: number,
  cursor?: QueryDocumentSnapshot,
  status?: OrderStatus,
): Promise<OrdersPage> {
  const cons: QueryConstraint[] = [where('shopId', '==', shopId)];
  if (status) cons.push(where('status', '==', status));
  cons.push(orderBy('createdAt', 'desc'));
  if (cursor) cons.push(startAfter(cursor));
  cons.push(limit(pageSize));
  const snap = await getDocs(query(collection(getDb(), 'orders'), ...cons));
  return {
    orders: snap.docs.map((d) => withId<Order>(d.id, d.data())),
    cursor: snap.docs.at(-1),
    hasMore: snap.docs.length === pageSize,
  };
}

/**
 * Every order created in a date window, oldest cursor first page-by-page until exhausted.
 * One-shot (no listener) because the callers — analytics and the day-close report — want a
 * stable snapshot, not a feed that shifts under them mid-render.
 */
export async function fetchOrdersInRange(
  shopId: string,
  from: Date,
  to: Date,
  hardCap = 2000,
): Promise<Order[]> {
  const out: Order[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  const PAGE = 300;
  while (out.length < hardCap) {
    const cons: QueryConstraint[] = [
      where('shopId', '==', shopId),
      where('createdAt', '>=', Timestamp.fromDate(from)),
      where('createdAt', '<=', Timestamp.fromDate(to)),
      orderBy('createdAt', 'desc'),
    ];
    if (cursor) cons.push(startAfter(cursor));
    cons.push(limit(PAGE));
    // Sequential by necessity: each page's cursor comes from the previous response.
    // eslint-disable-next-line no-await-in-loop
    const snap = await getDocs(query(collection(getDb(), 'orders'), ...cons));
    out.push(...snap.docs.map((d) => withId<Order>(d.id, d.data())));
    if (snap.docs.length < PAGE) break;
    cursor = snap.docs.at(-1);
  }
  return out;
}

/** Statuses that still need somebody to act on the order. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['new', 'accepted', 'packed', 'out_for_delivery'];

/**
 * Live feed of orders still awaiting action — what the dashboard badge and the order queue
 * actually care about. Bounded, and naturally small: an unserved backlog of more than a few
 * dozen means something is wrong operationally, not that the query needs raising.
 */
export function subscribeOpenOrders(
  shopId: string,
  cb: (o: Order[]) => void,
  max = 50,
): Unsubscribe {
  const q = query(
    collection(getDb(), 'orders'),
    where('shopId', '==', shopId),
    where('status', 'in', OPEN_ORDER_STATUSES),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Order>(d.id, d.data()))));
}

/** Live feed of ONE order. Used by the detail screens so they never depend on the
 * paginated list window happening to contain the order being opened. */
export function subscribeOrder(id: string, cb: (o: Order | null) => void): Unsubscribe {
  return onSnapshot(doc(getDb(), 'orders', id), (s) =>
    cb(s.exists() ? withId<Order>(s.id, s.data()) : null),
  );
}

/**
 * One-shot read of a single order. Used by the buyer live-tracking screen, which polls on a
 * fixed interval only while open/foregrounded rather than holding an open listener — so reads
 * are spent only while the customer is actually watching the map, never in the background.
 */
export async function getOrder(id: string): Promise<Order | null> {
  const s = await getDoc(doc(getDb(), 'orders', id));
  return s.exists() ? withId<Order>(s.id, s.data()) : null;
}

export function subscribeCustomerOrders(
  customerId: string,
  cb: (o: Order[]) => void,
): Unsubscribe {
  const q = query(
    collection(getDb(), 'orders'),
    where('customerId', '==', customerId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Order>(d.id, d.data()))));
}

export interface OrdersPage {
  orders: Order[];
  cursor?: QueryDocumentSnapshot;
  hasMore: boolean;
}

/** Fetch one page of a customer's orders, newest-first. Pass the previous page's `cursor` to load more. */
export async function fetchCustomerOrdersPage(
  customerId: string,
  pageSize: number,
  cursor?: QueryDocumentSnapshot,
): Promise<OrdersPage> {
  const cons: QueryConstraint[] = [
    where('customerId', '==', customerId),
    orderBy('createdAt', 'desc'),
  ];
  if (cursor) cons.push(startAfter(cursor));
  cons.push(limit(pageSize));
  const snap = await getDocs(query(collection(getDb(), 'orders'), ...cons));
  return {
    orders: snap.docs.map((d) => withId<Order>(d.id, d.data())),
    cursor: snap.docs.at(-1),
    hasMore: snap.docs.length === pageSize,
  };
}

export async function placeOrder(input: {
  shopId: string;
  customerId: string;
  customerName?: string;
  items: OrderItem[];
  note?: string | null;
  address?: Address | null;
  pincode?: string | null;
  deliveryFee?: number;
  couponCode?: string | null;
  discount?: number;
  customerPhone?: string | null;
  placedAtMs?: number;
  paymentMode?: PaymentMode;
  /** Loyalty points spent on this order; their ₹ value must already be inside `discount`. */
  loyaltyRedeemed?: number;
}): Promise<string> {
  const subtotal = input.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const deliveryFee = input.deliveryFee ?? 0;
  const discount = input.discount ?? 0;
  const grandTotal = Math.max(0, Math.round((subtotal + deliveryFee - discount) * 100) / 100);
  const r = await addDoc(collection(getDb(), 'orders'), {
    shopId: input.shopId,
    orderCode: makeOrderCode(),
    customerId: input.customerId,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    items: input.items,
    subtotal,
    total: subtotal, // alias, back-compat
    deliveryFee,
    couponCode: input.couponCode ?? null,
    discount,
    grandTotal,
    paymentMode: input.paymentMode ?? 'cod',
    paymentStatus: 'pending',
    upiRef: null,
    address: input.address ?? null,
    pincode: input.pincode ?? null,
    status: 'new',
    assignedTo: null,
    note: input.note ?? null,
    changeLog: [],
    loyaltyRedeemed: Math.max(0, Math.floor(input.loyaltyRedeemed ?? 0)),
    statusLog: [
      {
        at: input.placedAtMs ?? Date.now(),
        by: input.customerId,
        byName: input.customerName ?? null,
        status: 'new',
      },
    ],
    amountDelta: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return r.id;
}

/**
 * Record an in-store POS sale. Written to the same `orders` collection (so it flows into
 * order history + analytics) with `channel: 'pos'`, already `served` and `verified` (paid at
 * the counter). The operator is the signed-in staff member. Returns the new order's doc id and
 * its public `orderCode`.
 */
export async function placePosSale(input: {
  shopId: string;
  operatorId: string;
  operatorName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: OrderItem[];
  paymentMode: PaymentMode;
  nowMs?: number;
}): Promise<{ id: string; orderCode: string }> {
  const subtotal = input.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = Math.max(0, Math.round(subtotal * 100) / 100);
  const at = input.nowMs ?? Date.now();
  const orderCode = makeOrderCode();
  const r = await addDoc(collection(getDb(), 'orders'), {
    shopId: input.shopId,
    channel: 'pos',
    orderCode,
    // The operator owns the record (satisfies the per-user create rule); no buyer account.
    customerId: input.operatorId,
    customerName: input.customerName?.trim() || 'Walk-in',
    customerPhone: input.customerPhone?.trim() || null,
    items: input.items,
    subtotal,
    total,
    deliveryFee: 0,
    couponCode: null,
    discount: 0,
    grandTotal: total,
    paymentMode: input.paymentMode,
    paymentStatus: 'verified', // paid at the counter
    upiRef: null,
    address: null,
    pincode: null,
    status: 'served',
    assignedTo: input.operatorId,
    note: 'POS sale',
    changeLog: [],
    statusLog: [
      { at, by: input.operatorId, byName: input.operatorName ?? null, status: 'served' },
    ],
    amountDelta: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: r.id, orderCode };
}
export async function editOrderItems(
  order: Order,
  items: OrderItem[],
  by: string,
  nowMs: number,
  note = 'Items updated',
): Promise<void> {
  const newSubtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = order.deliveryFee ?? 0;
  const newGrand = newSubtotal + deliveryFee;
  const prevGrand = order.grandTotal ?? order.total ?? 0;
  const delta = Math.round((newGrand - prevGrand) * 100) / 100;
  const change: OrderChange = { at: nowMs, by, type: 'edit', note, delta };
  await updateDoc(doc(getDb(), 'orders', order.id), {
    items,
    subtotal: newSubtotal,
    total: newSubtotal,
    grandTotal: newGrand,
    amountDelta: Math.round(((order.amountDelta ?? 0) + delta) * 100) / 100,
    changeLog: [...(order.changeLog ?? []), change],
    updatedAt: serverTimestamp(),
  });
}

/**
 * A sales employee accepts a new order. Decrements stock for stock-tracked items (in a
 * transaction) and marks `stockApplied` so a later cancel can restock.
 */
export async function acceptOrder(
  order: Order,
  employeeUid: string,
  actorName?: string | null,
  atMs: number = Date.now(),
): Promise<void> {
  const db = getDb();
  await runTransaction(db, async (tx) => {
    const productRefs = order.items.map((i) => doc(db, 'products', i.productId));
    const snaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
    snaps.forEach((snap, idx) => {
      if (!snap.exists()) return;
      const p = snap.data() as Product;
      if (p.trackStock) {
        const newStock = Math.max(0, (p.stock ?? 0) - order.items[idx].qty);
        tx.update(productRefs[idx], { stock: newStock, stockUpdatedAt: serverTimestamp() });
      }
    });
    tx.update(doc(db, 'orders', order.id), {
      status: 'accepted',
      assignedTo: employeeUid,
      stockApplied: true,
      statusLog: arrayUnion({ at: atMs, by: employeeUid, byName: actorName ?? null, status: 'accepted' }),
      updatedAt: serverTimestamp(),
    });
  });
}

/** Cancel an order, restoring stock if it had been decremented and not yet served. */
export async function cancelOrder(
  order: Order,
  actorUid?: string,
  actorName?: string | null,
  atMs: number = Date.now(),
): Promise<void> {
  const db = getDb();
  const restock =
    !!order.stockApplied && (order.status === 'accepted' || order.status === 'out_for_delivery');
  await runTransaction(db, async (tx) => {
    if (restock) {
      const productRefs = order.items.map((i) => doc(db, 'products', i.productId));
      const snaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
      snaps.forEach((snap, idx) => {
        if (!snap.exists()) return;
        const p = snap.data() as Product;
        if (p.trackStock) {
          tx.update(productRefs[idx], {
            stock: (p.stock ?? 0) + order.items[idx].qty,
            stockUpdatedAt: serverTimestamp(),
          });
        }
      });
    }
    tx.update(doc(db, 'orders', order.id), {
      status: 'cancelled',
      ...(restock ? { stockApplied: false } : {}),
      ...(actorUid
        ? { statusLog: arrayUnion({ at: atMs, by: actorUid, byName: actorName ?? null, status: 'cancelled' }) }
        : {}),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function setOrderStatus(
  id: string,
  status: OrderStatus,
  actor?: { uid: string; name?: string | null; atMs?: number },
): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    status,
    ...(actor
      ? {
          statusLog: arrayUnion({
            at: actor.atMs ?? Date.now(),
            by: actor.uid,
            byName: actor.name ?? null,
            status,
          }),
        }
      : {}),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Flag/unflag an in-progress order as running late. A lightweight status marker (no
 * `statusLog` entry — it can flip both ways), written by the sales/delivery person; the
 * buyer app reads it to show a "Running late" badge. Staff order-updates are already
 * permitted by Security Rules, so no extra grant is needed.
 */
export async function setOrderRunningLate(id: string, runningLate: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    runningLate,
    updatedAt: serverTimestamp(),
  } as UpdateData<Order>);
}

/**
 * Stamp who is delivering an order (the staff member who moved it to `out_for_delivery`),
 * plus an optional first location fix. A lightweight non-`statusLog` write, like
 * `setOrderRunningLate`; staff order-updates are already permitted by Security Rules.
 */
export async function setOrderCourier(
  id: string,
  courier: { uid: string; name?: string | null; lat?: number; lng?: number; atMs?: number },
): Promise<void> {
  const patch: UpdateData<Order> = {
    courierId: courier.uid,
    courierName: courier.name ?? null,
    updatedAt: serverTimestamp(),
  } as UpdateData<Order>;
  if (typeof courier.lat === 'number' && typeof courier.lng === 'number') {
    Object.assign(patch, {
      courierLat: courier.lat,
      courierLng: courier.lng,
      courierUpdatedAt: courier.atMs ?? Date.now(),
    });
  }
  await updateDoc(doc(getDb(), 'orders', id), patch);
}

/**
 * Write a fresh courier position onto an order. Called repeatedly (throttled by distance) by
 * the courier device while delivering; the buyer's live map reads it. `atMs` is a client-clock
 * epoch stamp (consistent with `statusLog.at`), not a serverTimestamp, so the buyer can show
 * "updated Ns ago" without a second field read.
 */
export async function updateOrderCourierLocation(
  id: string,
  lat: number,
  lng: number,
  atMs: number,
): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    courierLat: lat,
    courierLng: lng,
    courierUpdatedAt: atMs,
    updatedAt: serverTimestamp(),
  } as UpdateData<Order>);
}

/**
 * Stamp that the "reaching your doorstep" push has been fired for an order, once. Written by
 * the courier device when it first enters the shop's arrival radius; its presence stops the
 * push repeating. Lightweight `updateDoc`, staff-permitted like the other courier writes.
 */
export async function markOrderArrivalNotified(id: string, atMs: number): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    arrivalNotifiedAt: atMs,
    updatedAt: serverTimestamp(),
  } as UpdateData<Order>);
}

/** Buyer marks a UPI order as paid (self-reported; the shop still reconciles manually). */
export async function markOrderPaymentClaimed(id: string, upiRef?: string): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    paymentStatus: 'claimed',
    upiRef: upiRef?.trim() || null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Buyer cancels their own order while it is still `new` (before the shop accepts).
 * No stock restock is needed because stock is only applied on accept. Security Rules
 * restrict this to the owner, a `new`→`cancelled` transition, and an unchanged total.
 */
export async function buyerCancelOrder(
  id: string,
  actor?: { uid: string; name?: string | null; atMs?: number },
): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    status: 'cancelled',
    ...(actor
      ? {
          statusLog: arrayUnion({
            at: actor.atMs ?? Date.now(),
            by: actor.uid,
            byName: actor.name ?? null,
            status: 'cancelled',
          }),
        }
      : {}),
    updatedAt: serverTimestamp(),
  });
}

/** Shopkeeper confirms the payment landed in their UPI/bank account. */
/**
 * Assign the next sequential invoice number to an order, once. The counter lives on the
 * shop doc and is bumped in the same transaction as the stamp, so two staff printing the
 * same bill simultaneously can't both claim the same number. Re-printing an already
 * numbered order returns the existing value untouched.
 */
export async function assignInvoiceNumber(shopId: string, orderId: string): Promise<string> {
  const shopRef = doc(getDb(), 'shops', shopId);
  const orderRef = doc(getDb(), 'orders', orderId);
  return runTransaction(getDb(), async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error('Order not found');
    const existing = (orderSnap.data() as Order).invoiceNo;
    if (existing) return existing;

    const shopSnap = await tx.get(shopRef);
    const next = Number((shopSnap.data() as Shop | undefined)?.invoiceSeq ?? 0) + 1;
    const year = new Date().getFullYear();
    const invoiceNo = `INV-${year}-${String(next).padStart(5, '0')}`;

    tx.set(shopRef, { invoiceSeq: next }, { merge: true });
    tx.update(orderRef, { invoiceNo } as UpdateData<Order>);
    return invoiceNo;
  });
}

export async function setOrderPaymentVerified(id: string): Promise<void> {  await updateDoc(doc(getDb(), 'orders', id), {
    paymentStatus: 'verified',
    updatedAt: serverTimestamp(),
  });
}

// ------------------------------------------------------------------- Buyer addresses
export async function saveAddresses(
  uid: string,
  addresses: Address[],
  defaultAddressId?: string | null,
): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', uid), {
    addresses,
    ...(defaultAddressId !== undefined ? { defaultAddressId } : {}),
  } as UpdateData<Customer>);
}

export async function setCustomerPhone(uid: string, phone: string): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', uid), { phone } as UpdateData<Customer>);
}

export async function setCustomerLocale(uid: string, locale: string): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', uid), { locale } as UpdateData<Customer>);
}

/**
 * Publish the buyer's own share code so friends' codes can be resolved back to them.
 * Rules only accept the value `referralCodeFor(uid)` produces, so this is safe to call
 * from the buyer app.
 */
export async function ensureReferralCode(uid: string, code: string): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', uid), { referralCode: code } as UpdateData<Customer>);
}

/**
 * Record who referred this buyer. Write-once by Rules: a buyer can claim a friend's code
 * before their first order is settled, but never swap it afterwards.
 */
export async function setReferredBy(uid: string, referrerCode: string): Promise<void> {
  await updateDoc(doc(getDb(), 'customers', uid), {
    referredBy: referrerCode.trim().toUpperCase(),
  } as UpdateData<Customer>);
}

/** Toggle a buyer's back-in-stock watch for a product. */
export async function setBackInStockWatch(
  customer: Customer,
  productId: string,
  on: boolean,
): Promise<void> {
  const cur = new Set(customer.notifyBackInStock ?? []);
  if (on) cur.add(productId);
  else cur.delete(productId);
  await updateDoc(doc(getDb(), 'customers', customer.id), {
    notifyBackInStock: [...cur],
  } as UpdateData<Customer>);
}

// ------------------------------------------------------------------- Delivery zones
export function subscribeDeliveryZones(cb: (z: DeliveryZone[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), 'deliveryZones'), (snap) =>
    cb(snap.docs.map((d) => d.data() as DeliveryZone)),
  );
}

export async function getZone(pincode: string): Promise<DeliveryZone | null> {
  const s = await getDoc(doc(getDb(), 'deliveryZones', pincode));
  return s.exists() ? (s.data() as DeliveryZone) : null;
}

export async function upsertZone(zone: DeliveryZone): Promise<void> {
  await setDoc(doc(getDb(), 'deliveryZones', zone.pincode), zone, { merge: true });
}

export async function deleteZone(pincode: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'deliveryZones', pincode));
}

/** Delivery fee for a subtotal in a zone (0 when at/above the free threshold). */
export function deliveryFeeFor(zone: DeliveryZone, subtotal: number): number {
  return subtotal >= zone.freeAbove ? 0 : zone.deliveryFee;
}

// -------------------------------------------------------------------------- Coupons
export function subscribeCoupons(shopId: string, cb: (c: Coupon[]) => void): Unsubscribe {
  const q = query(collection(getDb(), 'coupons'), where('shopId', '==', shopId));
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ ...(d.data() as Coupon), code: d.id }))),
  );
}

export async function getCoupon(code: string): Promise<Coupon | null> {
  const s = await getDoc(doc(getDb(), 'coupons', code.trim().toUpperCase()));
  return s.exists() ? { ...(s.data() as Coupon), code: s.id } : null;
}

export async function upsertCoupon(coupon: Coupon): Promise<void> {
  const code = coupon.code.trim().toUpperCase();
  await setDoc(
    doc(getDb(), 'coupons', code),
    { ...coupon, code, createdAt: coupon.createdAt ?? serverTimestamp() },
    { merge: true },
  );
}

export async function deleteCoupon(code: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'coupons', code.trim().toUpperCase()));
}

// -------------------------------------------------------------------------- Reviews
export function subscribeProductReviews(productId: string, cb: (r: Review[]) => void): Unsubscribe {
  const q = query(
    collection(getDb(), 'reviews'),
    where('productId', '==', productId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Review>(d.id, d.data()))));
}

/** All reviews for a shop — lets the buyer catalog show per-product average ratings.
 *  Single equality filter, so no composite index is required. */
export function subscribeShopReviews(shopId: string, cb: (r: Review[]) => void): Unsubscribe {
  const q = query(collection(getDb(), 'reviews'), where('shopId', '==', shopId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Review>(d.id, d.data()))));
}

/** Create or edit the signed-in buyer's review for a product (doc id = `${productId}_${uid}`). */
export async function upsertReview(input: {
  productId: string;
  shopId: string;
  uid: string;
  customerName?: string | null;
  rating: number;
  text?: string | null;
}): Promise<void> {
  const id = `${input.productId}_${input.uid}`;
  const ref = doc(getDb(), 'reviews', id);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      productId: input.productId,
      shopId: input.shopId,
      uid: input.uid,
      customerName: input.customerName ?? null,
      rating: input.rating,
      text: input.text?.trim() || null,
      createdAt: existing.exists() ? existing.data()?.createdAt ?? serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteReview(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'reviews', id));
}

// ----------------------------------------------------------------- Delivery feedback
/** A buyer rates the delivery of one of their served orders (doc id = orderId). */
export async function upsertDeliveryFeedback(input: {
  orderId: string;
  shopId: string;
  uid: string;
  customerName?: string | null;
  rating: number;
  text?: string | null;
}): Promise<void> {
  const ref = doc(getDb(), 'deliveryFeedback', input.orderId);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      orderId: input.orderId,
      shopId: input.shopId,
      uid: input.uid,
      customerName: input.customerName ?? null,
      rating: input.rating,
      text: input.text?.trim() || null,
      createdAt: existing.exists() ? existing.data()?.createdAt ?? serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** All delivery feedback for a shop (admin feedback screen). */
export function subscribeDeliveryFeedback(
  shopId: string,
  cb: (f: DeliveryFeedback[]) => void,
): Unsubscribe {
  const q = query(collection(getDb(), 'deliveryFeedback'), where('shopId', '==', shopId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<DeliveryFeedback>(d.id, d.data()))));
}

// --------------------------------------------------------------------- Subscriptions
/** Create a product subscription. `nextRun` is the first fire time, computed on the device. */
export async function addSubscription(
  input: Omit<Subscription, 'id' | 'nextRunAt' | 'lastRunAt' | 'createdAt'>,
  nextRun: Date,
): Promise<string> {
  const r = await addDoc(collection(getDb(), 'subscriptions'), {
    ...input,
    nextRunAt: Timestamp.fromDate(nextRun),
    lastRunAt: null,
    createdAt: serverTimestamp(),
  });
  return r.id;
}

export function subscribeMySubscriptions(
  customerId: string,
  cb: (s: Subscription[]) => void,
): Unsubscribe {
  const q = query(
    collection(getDb(), 'subscriptions'),
    where('customerId', '==', customerId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Subscription>(d.id, d.data()))));
}

/** Pause/resume a subscription. When resuming, pass a fresh `nextRun` so a stale past time
 *  doesn't make the Worker fire it immediately. */
export async function setSubscriptionActive(
  id: string,
  active: boolean,
  nextRun?: Date,
): Promise<void> {
  await updateDoc(doc(getDb(), 'subscriptions', id), {
    active,
    ...(nextRun ? { nextRunAt: Timestamp.fromDate(nextRun) } : {}),
  } as UpdateData<Subscription>);
}

export async function deleteSubscription(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'subscriptions', id));
}

// -------------------------------------------------------------------- Announcements
/** Active announcements for a shop (buyer Home card). */
export function subscribeAnnouncements(shopId: string, cb: (a: Announcement[]) => void): Unsubscribe {
  const q = query(
    collection(getDb(), 'announcements'),
    where('shopId', '==', shopId),
    where('active', '==', true),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Announcement>(d.id, d.data()))));
}

export async function addAnnouncement(
  input: Omit<Announcement, 'id' | 'createdAt' | 'expiresAt'> & { ttlHours?: number },
): Promise<string> {
  const { ttlHours, ...rest } = input;
  const hours =
    typeof ttlHours === 'number' && ttlHours > 0 ? ttlHours : DEFAULT_ANNOUNCEMENT_TTL_HOURS;
  const r = await addDoc(collection(getDb(), 'announcements'), {
    ...rest,
    // Client-clock expiry (announcements aren't security-critical); buyers also apply a
    // createdAt-based fallback so even a missing value ages out.
    expiresAt: Timestamp.fromMillis(Date.now() + hours * 3_600_000),
    createdAt: serverTimestamp(),
  });
  return r.id;
}

export async function setAnnouncementActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'announcements', id), { active });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'announcements', id));
}

// ---------------------------------------------------------------------- Push tokens
export async function setPushToken(
  uid: string,
  token: string,
  kind: 'admin' | 'buyer',
  roles?: Role[] | null,
): Promise<void> {
  const roleFields =
    roles !== undefined
      ? { role: roles && roles.length > 0 ? roles[0] : null, roles: roles ?? [] }
      : {};
  await setDoc(
    doc(getDb(), 'pushTokens', uid),
    { token, kind, ...roleFields, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Flip a user's personal order-notification switch (server honours `notify === false`). */
export async function setPushNotify(uid: string, notify: boolean): Promise<void> {
  await setDoc(doc(getDb(), 'pushTokens', uid), { notify }, { merge: true });
}

/** Read a user's push-token doc (for the notification-preference toggle). */
export async function getPushToken(uid: string): Promise<PushToken | null> {
  const s = await getDoc(doc(getDb(), 'pushTokens', uid));
  return s.exists() ? (s.data() as PushToken) : null;
}

// ---------------------------------------------------------------------------- Purge
// Superuser-only destructive resets for onboarding/testing. Each deletes every doc in a
// collection (batched), returning the count removed. Rules still enforce superuser.
async function deleteAllDocs(collName: string, exceptId?: string): Promise<number> {
  const snap = await getDocs(collection(getDb(), collName));
  const refs = snap.docs.filter((d) => d.id !== exceptId).map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(getDb());
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

/** Delete all products + categories. */
export async function purgeProducts(): Promise<number> {
  const p = await deleteAllDocs('products');
  const c = await deleteAllDocs('categories');
  return p + c;
}

/** Delete all orders (and history). */
export async function purgeOrders(): Promise<number> {
  return deleteAllDocs('orders');
}

/** Delete all customers. */
export async function purgeCustomers(): Promise<number> {
  return deleteAllDocs('customers');
}

/** Delete every doc in a collection whose `uid` field differs from `exceptUid`. */
async function deleteDocsByUidExcept(collName: string, exceptUid: string): Promise<number> {
  const snap = await getDocs(collection(getDb(), collName));
  const refs = snap.docs
    .filter((d) => (d.data() as { uid?: string | null }).uid !== exceptUid)
    .map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(getDb());
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

/**
 * Delete all admin users except the current superuser, plus pending requests and the
 * entire employee roster (the "Team" list) — invited employees included. The acting
 * superuser's own employee record (if any, matched by its `uid` field) is preserved.
 * Returns the total number of docs removed across users + pendingUsers + employees.
 */
export async function purgeUsersExceptCurrent(currentUid: string): Promise<number> {
  const users = await deleteAllDocs('users', currentUid);
  const pending = await deleteAllDocs('pendingUsers').catch(() => 0);
  const employees = await deleteDocsByUidExcept('employees', currentUid).catch(() => 0);
  return users + pending + employees;
}

// --------------------------------------------------------------- Roles / users mgmt
export function subscribeUsers(shopId: string, cb: (u: AppUser[]) => void): Unsubscribe {
  const q = query(collection(getDb(), 'users'), where('shopId', '==', shopId));
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<AppUser, 'uid'>) }))),
  );
}

export function subscribePendingUsers(cb: (p: PendingUser[]) => void): Unsubscribe {
  return onSnapshot(collection(getDb(), 'pendingUsers'), (snap) =>
    cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<PendingUser, 'uid'>) }))),
  );
}

/** Self-registered on first admin-app sign-in when the user has no role yet. */
export async function upsertPendingUser(uid: string, email: string, name: string): Promise<void> {
  await setDoc(
    doc(getDb(), 'pendingUsers', uid),
    { uid, email, name, requestedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Grant one or more roles (creates/updates the users doc) and clear any pending request. */
export async function assignRole(input: {
  uid: string;
  email: string;
  name: string;
  /** One or more roles. The first is mirrored into `role` for back-compat/display. */
  roles: Role[];
  shopId: string;
}): Promise<void> {
  const roles = input.roles.length > 0 ? input.roles : (['sales'] as Role[]);
  await setDoc(
    doc(getDb(), 'users', input.uid),
    {
      email: input.email,
      name: input.name,
      role: roles[0],
      roles,
      shopId: input.shopId,
      active: true,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  await deleteDoc(doc(getDb(), 'pendingUsers', input.uid)).catch(() => {});
}

/** Replace the set of roles on an existing user. First role mirrored into `role`. */
export async function updateUserRoles(uid: string, roles: Role[]): Promise<void> {
  const next = roles.length > 0 ? roles : (['sales'] as Role[]);
  await updateDoc(doc(getDb(), 'users', uid), { role: next[0], roles: next });
}

export async function setUserActive(uid: string, active: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'users', uid), { active });
}

export async function removeUser(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'users', uid));
}

// -------------------------------------------------------------------------- Secrets
export async function getFast2SmsKey(): Promise<string | null> {
  const s = await getDoc(doc(getDb(), 'secrets', 'fast2sms'));
  return s.exists() ? ((s.data() as { apiKey?: string }).apiKey ?? null) : null;
}

export async function setFast2SmsKey(apiKey: string): Promise<void> {
  await setDoc(
    doc(getDb(), 'secrets', 'fast2sms'),
    { apiKey, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// --------------------------------------------------------------------------- Images
// Base64 images live in their own `images/{id}` collection (not on the owning doc) so
// list reads stay small. The id is immutable per upload, so callers cache by id.
export interface StoredImage {
  data: string; // base64 (no data: prefix)
  mime: string;
}

/** Firestore's hard per-document cap is 1 MiB; keep image payloads well under it. */
export const MAX_IMAGE_BASE64_BYTES = 900_000;

/** Store a base64 image and return its new doc id. Throws if the payload is too large. */
export async function putImage(base64: string, mime: string): Promise<string> {
  if (base64.length > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(
      `Image too large (${Math.round(base64.length / 1024)} KB encoded). Firestore caps a document at ~1 MB — compress/resize further.`,
    );
  }
  const r = await addDoc(collection(getDb(), 'images'), {
    data: base64,
    mime,
    // Recorded so the usage screen can sum() storage without downloading every blob.
    // Images written before this field existed simply aren't counted (reported separately).
    bytes: base64.length,
    createdAt: serverTimestamp(),
  });
  return r.id;
}

// ---------------------------------------------------------------------------- Usage
/**
 * Collections surfaced on the superuser usage screen, in the order they are shown.
 * `images` is listed last because it is the one that actually consumes storage.
 */
export const USAGE_COLLECTIONS = [
  'products',
  'categories',
  'orders',
  'customers',
  'users',
  'employees',
  'reviews',
  'deliveryFeedback',
  'subscriptions',
  'coupons',
  'announcements',
  'deliveryZones',
  'pushTokens',
  'images',
] as const;

export type UsageCollection = (typeof USAGE_COLLECTIONS)[number];

export interface UsageSnapshot {
  /** Exact document count per collection. */
  counts: Record<string, number>;
  totalDocs: number;
  /** Summed `bytes` of image docs that carry the field (base64 length). */
  imageBytesKnown: number;
  /** Image docs written before `bytes` was recorded — not included in the sum above. */
  imagesUnmeasured: number;
  /** Firestore reads this snapshot itself consumed, for honesty about its own cost. */
  readsUsed: number;
  takenAt: number;
}

/**
 * Count documents and measure image storage using server-side aggregations.
 *
 * Aggregations bill one read per 1000 documents scanned rather than one per document, so a
 * full snapshot of a shop with a few thousand docs costs single-digit reads. Crucially it
 * never downloads an image blob — summing the recorded `bytes` field is what makes a
 * storage figure affordable at all.
 */
export async function fetchUsageSnapshot(): Promise<UsageSnapshot> {
  const db = getDb();
  const counts: Record<string, number> = {};
  let readsUsed = 0;

  const results = await Promise.all(
    USAGE_COLLECTIONS.map(async (name) => {
      try {
        const snap = await getCountFromServer(collection(db, name));
        return [name, snap.data().count] as const;
      } catch {
        // A collection the caller can't read (or that doesn't exist yet) reports as -1
        // rather than failing the whole snapshot.
        return [name, -1] as const;
      }
    }),
  );
  for (const [name, count] of results) {
    counts[name] = count;
    if (count > 0) readsUsed += Math.ceil(count / 1000);
  }

  let imageBytesKnown = 0;
  let imagesUnmeasured = 0;
  try {
    // The range filter is what restricts the aggregate to docs that actually carry `bytes`
    // — an unfiltered count() would count legacy docs too and always report 0 unmeasured.
    // `bytes` is a single field, so Firestore's automatic index covers this with no deploy.
    const agg = await getAggregateFromServer(
      query(collection(db, 'images'), where('bytes', '>=', 0)),
      { total: sum('bytes'), measured: count() },
    );
    imageBytesKnown = Number(agg.data().total ?? 0);
    const measured = Number(agg.data().measured ?? 0);
    imagesUnmeasured = Math.max(0, (counts.images ?? 0) - measured);
    readsUsed += 1;
  } catch {
    imagesUnmeasured = Math.max(0, counts.images ?? 0);
  }

  return {
    counts,
    totalDocs: Object.values(counts).reduce((s, n) => s + Math.max(0, n), 0),
    imageBytesKnown,
    imagesUnmeasured,
    readsUsed,
    takenAt: Date.now(),
  };
}

export async function getImage(id: string): Promise<StoredImage | null> {  const s = await getDoc(doc(getDb(), 'images', id));
  if (!s.exists()) return null;
  const d = s.data() as { data?: string; mime?: string };
  return d.data ? { data: d.data, mime: d.mime ?? 'image/jpeg' } : null;
}

export async function deleteImage(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'images', id));
}
