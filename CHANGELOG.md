# Changelog

All notable changes to this project. Dates are the date the work landed.

---

## 2026-11-06

Theme: **the delivery leg** — live courier tracking end-to-end, a clearer order lifecycle, and a
dashboard tidy-up.

### Added — live delivery tracking

- **Courier location sharing (seller).** Tapping *Out for delivery* makes that staff member the
  order's courier; their device streams its position to the order via a foreground-service
  background location task (`expo-task-manager`), writing only past a superuser-tunable distance
  (default 20 m; Notifications screen).
  → [`admin-app/src/lib/delivery-task.ts`](admin-app/src/lib/delivery-task.ts),
  [`admin-app/src/lib/delivery-tracking.tsx`](admin-app/src/lib/delivery-tracking.tsx)
- **Live map for buyers.** The buyer's order card shows the courier and delivery pin on an
  OpenStreetMap (Leaflet-in-WebView) map with a curved flight-path arc. "Track on map" swaps the
  status animation for the map **inline** and polls the order on the same 10 s cadence, only while
  the tab is focused. → [`buyer-app/src/components/delivery-map.tsx`](buyer-app/src/components/delivery-map.tsx)
- **"Arriving" push.** When the courier comes within the shop's arrival radius of the delivery
  pin, the buyer gets a one-time "reaching your doorstep" push (new `order-arriving` Worker event).
- **Playful status animations** on the buyer order trail: a packing scene (accepted/packed) and a
  highway-delivery scene (out-for-delivery).
  → [`buyer-app/src/components/order-status-animation.tsx`](buyer-app/src/components/order-status-animation.tsx)

### Added — order lifecycle & identity

- **New `packed` status**: `new → accepted → packed → out_for_delivery → served`. Admin gets a
  *Mark packed* step; the buyer is pushed "packed and waiting to be picked up by a delivery agent".
- **Running late / On time** badge on in-progress orders, toggled by the courier/sales person.
- **Public order IDs** (`mkenXXXXXX`) shown to buyers and sellers, with an **order-ID search box**
  on both order lists (POS sales included). → [`common/src/util/ordercode.ts`](common/src/util/ordercode.ts)

### Changed — admin information architecture

- **Settings split** into three dashboard tiles (all super-user + admin): **Settings** (language,
  name, logo, UPI), **Contact Details** (address / phones / email / map pin), **Store
  Configuration** (hours, subscriptions, delivery areas).
  → [`admin-app/src/app/(app)/contact.tsx`](admin-app/src/app/(app)/contact.tsx),
  [`admin-app/src/app/(app)/store.tsx`](admin-app/src/app/(app)/store.tsx)
- **Team & Roles** moved inside **Employees**; **admins now have employee access**
  (`employees.read`/`employees.write` + a matching `employees` Security Rule), while only a
  super-user may see/assign the `superuser` role.

### Fixed

- **Stale broadcast banners.** Announcements now carry a TTL (admin picks hours, default 24 h);
  the buyer Home hides expired banners, with a `createdAt + 24 h` fallback so a fresh device no
  longer sees a week-old backlog of still-active test broadcasts.
  → [`common/src/util/announce.ts`](common/src/util/announce.ts)

---

## 2026-11-01

Two themes: **making the apps survive a real catalogue** (the 500-product regression), and
**closing the operational gaps** — observability, reconciliation, invoicing and loyalty.

### Fixed — performance & stability

- **Admin "Update inventory" crashed on open.** The screen rendered every matching product
  as a card inside a plain `ScrollView`, and each row mounts 2–3 native `TextInput`s. At 500
  products that is ~1 500 eagerly-mounted inputs. Replaced with a virtualised `FlatList`
  (`initialNumToRender=6`, `windowSize=5`), memoised the row, and routed the search box
  through `useDeferredValue` so `fuzzyFilter` no longer blocks each keystroke.
  → [`admin-app/src/app/(app)/inventory.tsx`](admin-app/src/app/(app)/inventory.tsx)

- **Buyer home stalled with many featured items.** The "Featured" row is a non-virtualised
  horizontal `ScrollView`, so every card and image mounted eagerly. Hard-capped at
  `MAX_FEATURED_PRODUCTS = 10`, enforced on both sides: the buyer slices the list, and the
  admin product editor refuses to feature an eleventh item.

- **Unbounded order feeds.** `subscribeOrders` had no `limit()` — it re-downloaded and
  re-rendered the shop's *entire* order history on every write, getting worse every day.
  Now takes a `max` (default 25). The admin list keeps a live 25-order head plus cursor
  paging via `fetchOrdersPage`, merged by id so the realtime copy always wins.
  Dashboard moved to a new bounded `subscribeOpenOrders`; analytics capped at 500.

- **Order detail broke for older orders.** Once the list became bounded, the detail screen —
  which found its order inside that list — would have shown "not found" for anything deeper
  than the first page. Now uses a new single-doc `subscribeOrder(id)`.

- **Product images dominated list cost.** Images are base64 blobs of up to 900 KB in
  `images/{id}`; painting a 500-row list meant fetching all of them. Products now carry a
  `thumb` field (128 px / quality 0.4 JPEG data URI, ~3–5 KB) written at save time. Lists
  render `p.thumb ?? useCachedImage(p.imageId)`, so the full blob is fetched **only** on the
  detail and edit screens. Products saved before this fall back to the old path.

### Added — observability

- **Shared logger** with batching, level filtering and a pluggable sink.
  → [`common/src/util/logger.ts`](common/src/util/logger.ts)
- **Error boundary** in both apps, so a render crash shows a recoverable screen instead of a
  white app, and reports itself.
- **New Relic Log API sink** — a plain HTTPS POST, deliberately *not* a native agent, so it
  works under Expo's continuous native generation and needs no Blaze plan. Configured via
  `newRelicKey` / `newRelicRegion` in `app.local.json`; absent = logs stay on-device.
- Global handlers for uncaught JS errors; queued logs flush when the app backgrounds.
- Every line carries `app`, `appVersion`, `platform`, `platformVersion`, `shopId`, `uid`.

### Added — tests

- **vitest** with 79 tests over the money/time logic that had none: coupon evaluation,
  loyalty maths, shop hours, expiry, discount percentages, EAN-13 check digits, stock levels.
  `npm test` / `npm run test:watch`.

### Added — loyalty & referrals

- Admin **Loyalty & referrals** screen (🎁 dashboard tile, `shop.config`): master switch,
  an **independent** referrals switch, points per ₹100, minimum order to earn, ₹ per point,
  minimum redeemable balance, max % of an order payable by points, referrer/referee bonuses,
  Play Store link, and a live worked example.
- Points are credited when an order is marked **served**, via `settleLoyaltyForOrder`.
  Settlement is idempotent — an order already carrying `loyaltyEarned` is a no-op, so a
  double-tap cannot pay twice.
- Buyer: balance + referral code with native share in Profile, "Apply points" at checkout
  (stacks on coupons, honours the percentage cap), friend-code entry.
- **Security:** `customers` previously allowed a blanket self-write, so a buyer could mint
  their own points. Rules now split create/update/delete and reject self-writes touching
  `loyaltyPoints` / `referralSettled` / `referralCount`. Referral codes are derived as
  `REF + uid[0:6].upper()` *specifically* so Security Rules can recompute and verify them —
  nobody can claim someone else's code. `referredBy` is write-once.

### Added — admin operations

- **Low-stock alerts.** `reorderLevel` per product, `isLowStock`/`isOutOfStock` helpers, a
  dashboard alert card, and a "Restock" mode on the inventory screen (deep-linked via
  `?filter=low`).
- **Day-close / cash reconciliation.** On-demand PDF from Analytics: takings split by
  channel (online vs POS) and payment mode, cash-drawer total (counter cash + delivered COD),
  unverified-UPI count, COD not yet collected, cancellations, and a signature line.
- **In-house barcodes.** EAN-13 generation with correct check digits using GS1 prefix 20
  (restricted distribution — in-store use only), stable per product id, plus a printable
  label sheet where bars are plain `div`s, so no font or image asset is needed.
- **Invoices.** Shared `buildInvoiceHtml` so both apps print an identical bill. The admin
  copy claims the next sequential number (`INV-2026-00001`) transactionally against
  `shops.invoiceSeq`; the buyer copy does not (buyers cannot write the shop doc).
- **Order status timeline.** `statusLog` was written on every transition but never shown.
  Now rendered as a timeline on admin order detail and behind a "Track" toggle for buyers.
- **Firebase usage screen** (superuser). Exact per-collection document counts via
  `getCountFromServer`, and image storage via a `sum('bytes')` aggregation — which never
  downloads a blob. Clearly labelled an estimate; see *Known limitations*.
- **Featured filter** in the admin product list, plus `Featured` and `% OFF` badges.

### Added — buyer

- Discount **% OFF** badges on product and featured cards.
- **Share product** — name, price and the Play Store link when configured.
- **Pull-to-refresh** on Profile, plus a focus-effect refresh, so loyalty points update
  without restarting the app (points are minted by the *admin* app, so the buyer has no way
  to know otherwise).
- Invoice download per order.

### Changed

- Admin app renamed **Seller → MKEN ECommerce Admin** (launcher name, sign-in title,
  employee invite email, `en` + `ta`).
- `putImage` now records `bytes`, so storage can be summed without reading blobs.
- `Screen` in both kits accepts optional `onRefresh` / `refreshing`.
- `app.local.example.json` in both apps documents every key a developer must supply.

### Infrastructure

- **Firestore rules** — rewritten `customers` block (see *loyalty* above).
- **Firestore indexes** — added `customers (shopId, referralCode)` for referral lookup.
  Total 14.
- **Buyer app native deps** — added `expo-print` and `expo-sharing` for invoices. This
  regenerates native code; a stale dev client needs a rebuild.
- No Worker change; **no `wrangler deploy` required**.

```bash
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes
```

### Documentation

- [`docs/worker-token-verification.md`](docs/worker-token-verification.md) — how to replace
  the Worker's claim-only token check with real RS256 verification against Google's JWKS,
  with working code, a checklist and curl tests. **Must be done before public release.**
- [`docs/architecture.drawio`](docs/architecture.drawio) — page 1 updated: observability
  layer, new `@common/util` modules, new app `lib`/`components`, new schema fields, index
  count, and the `newRelicKey` config.

---

## Known limitations introduced or still open

| Area | Limitation |
|---|---|
| Usage screen | Estimates storage (measured image bytes + ~1 KB/doc). Firestore also bills index storage, so the real figure is higher. Google does not expose live read/write counters to client apps — only the console and Cloud Monitoring do. A Worker + Cloud Monitoring API endpoint would give true numbers. |
| Image thumbnails | Only generated on save. Existing products keep the old full-blob path until re-saved. |
| Loyalty redemption | Submitted by the client, like item prices already were in `placeOrder`. Consistent with the existing trust model, but a tampered client could over-redeem. `creditLoyaltyPoints` clamps at zero and the seller sees the total before accepting. Proper fix is server-side order creation. |
| Inventory list | Virtualised, so an unsaved edit in a row scrolled far off-screen resets on remount. Mitigated with `removeClippedSubviews={false}` and a modest window. |
| In-house barcodes | GS1 prefix 20 is *restricted distribution* — valid in-store only, never for goods resold through another retailer. |
| Worker auth | Claim-check only, no signature verification. See `docs/worker-token-verification.md`. |
| Fast2SMS key / OTP | Still client-readable; pre-existing accepted risk. |
