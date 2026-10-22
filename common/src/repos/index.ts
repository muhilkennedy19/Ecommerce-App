import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
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
  AppUser,
  Category,
  Coupon,
  Customer,
  DeliveryZone,
  Employee,
  Order,
  OrderChange,
  OrderItem,
  OrderStatus,
  PendingUser,
  Product,
  PushToken,
  Role,
  Shop,
} from '../types';
import { DEFAULT_OPERATING_HOURS } from '../util/time';

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

// --------------------------------------------------------------------------- Orders
export function subscribeOrders(
  shopId: string,
  cb: (o: Order[]) => void,
  status?: OrderStatus,
): Unsubscribe {
  const cons: QueryConstraint[] = [where('shopId', '==', shopId)];
  if (status) cons.push(where('status', '==', status));
  cons.push(orderBy('createdAt', 'desc'));
  const q = query(collection(getDb(), 'orders'), ...cons);
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => withId<Order>(d.id, d.data()))));
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
    cursor: snap.docs[snap.docs.length - 1],
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
  paymentMode?: 'cod' | 'upi';
}): Promise<string> {
  const subtotal = input.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const deliveryFee = input.deliveryFee ?? 0;
  const discount = input.discount ?? 0;
  const grandTotal = Math.max(0, Math.round((subtotal + deliveryFee - discount) * 100) / 100);
  const r = await addDoc(collection(getDb(), 'orders'), {
    shopId: input.shopId,
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
 * Sales/superuser edits an accepted order's items. Recomputes totals, appends a change-log
 * entry, and accumulates `amountDelta` (+ customer pays more, − refund) for manual settlement.
 */
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

/** Buyer marks a UPI order as paid (self-reported; the shop still reconciles manually). */
export async function markOrderPaymentClaimed(id: string, upiRef?: string): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
    paymentStatus: 'claimed',
    upiRef: upiRef?.trim() || null,
    updatedAt: serverTimestamp(),
  });
}

/** Shopkeeper confirms the payment landed in their UPI/bank account. */
export async function setOrderPaymentVerified(id: string): Promise<void> {
  await updateDoc(doc(getDb(), 'orders', id), {
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
    createdAt: serverTimestamp(),
  });
  return r.id;
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const s = await getDoc(doc(getDb(), 'images', id));
  if (!s.exists()) return null;
  const d = s.data() as { data?: string; mime?: string };
  return d.data ? { data: d.data, mime: d.mime ?? 'image/jpeg' } : null;
}

export async function deleteImage(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'images', id));
}
