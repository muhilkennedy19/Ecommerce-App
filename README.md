# E-commerce — Admin (Seller) + Buyer apps

A **simple e-commerce app built in React Native (Expo) for learning and demo purposes.** It's a
small but complete two-app system for a neighbourhood fruit & flower shop, backed entirely by
Firebase's free **Spark** plan (no paid backend, no Blaze) — a practical reference for how to ship
a real, role-based mobile commerce flow without running your own server.

Two Android-first React Native (Expo SDK 58) apps backed by Firebase as a serverless
backend, in an npm-workspaces monorepo with a shared `common` module.

- **admin-app/** — seller/shopkeeper app: products, employees, customers, live orders, analytics, settings.
- **buyer-app/** — customer app: browse, cart, checkout, order history.
- **common/** — shared types, Firebase client, roles/permissions, OTP, and data repositories (`@common`).
- **firebase/** — Firestore security rules + indexes. (A `storage.rules` is kept for a future
  Blaze/Storage upgrade but is unused — images are base64 in Firestore.)

> ⚠️ **Learning/demo project.** It favours clarity and a zero-cost footprint over
> production hardening. Some documented trade-offs (self-reported UPI, claim-check-only notify
> auth, a third-party SMS key readable by the app) are accepted for that purpose — see the
> Security section before using any of this for real.

## Architecture answers (the questions you asked up front)

1. **Serverless?** Yes — Firebase (BaaS). No self-run server. A handful of privileged
   operations (sending email/SMS, push) would normally need Cloud Functions; on the free
   **Spark** plan we avoid Functions entirely by: enforcing roles with **Security Rules +
   a `users/{uid}` role doc**, delivering order notifications via **in-app real-time
   listeners**, and showing daily price/stock reminders **in-app**.
2. **Ship API keys in the APK?** No. An APK is trivially decompiled. Third-party secrets
   (Gmail, Fast2SMS) must never ship on a device. The **Firebase config is NOT a secret**
   (it's a public project identifier) — it's safe in the app; protection comes from Auth +
   Rules. See **Security** below for the Fast2SMS exception you accepted.
3. **Firebase free tier?** Spark easily covers ~50 customers/week + 3–4 employees. (Cloud
   Functions would require the Blaze plan — we don't use them, so you stay on Spark.)
4. **Hosted DB, no server?** Yes — both apps read/write Firestore directly; Rules enforce
   who can do what.
5. **Firestore for images + Realtime DB for txns?** Partly revised in practice: Cloud Storage
   now requires the **Blaze** plan, so to stay on **Spark (free)** images are stored as
   **compressed base64 in a separate `images/{id}` Firestore collection** (the product/employee
   doc holds only the `imageId`; apps cache by id). **Firestore alone** handles orders/real-time/
   queries — no separate Realtime DB needed at this scale.

## Prerequisites

- Node 18+ (tested on Node 24), npm 9+.
- A **Firebase project** with:
  - **Authentication** → Google provider enabled.
  - **Cloud Firestore** enabled.
  - (Cloud Storage is **not** used — images are base64 in Firestore to stay on the free Spark plan.)
- **Android builds:** this uses native modules (Google Sign-In), so it needs a **development
  build** — it will NOT run in Expo Go. A local JDK 25 is installed here but Android/Gradle
  prefers **JDK 17**; the simplest path is **EAS cloud builds** (no local Android Studio/JDK needed).

## Configure

For **each** app (`admin-app/`, `buyer-app/`):

1. Edit `app.json` → `expo.extra`:
   - `firebase`: your Web app's `firebaseConfig` values (apiKey, authDomain, projectId,
     storageBucket, messagingSenderId, appId) — these are public/safe.
   - `googleWebClientId`: the **Web** OAuth client ID from Firebase Auth (so the Google
     idToken is accepted). Format `xxxx.apps.googleusercontent.com`.
   - `shopId`: leave as `"main"` (single-shop setup).
2. Download **`google-services.json`** for each app's Android package and place it at
   `admin-app/google-services.json` and `buyer-app/google-services.json`. Android packages:
   - admin: `com.ecommerce.admin`
   - buyer: `com.ecommerce.buyer`
3. In Firebase → Project settings → your Android app, register the app's **SHA-1** (from
   your debug keystore or EAS credentials) so Google Sign-In works on Android.

## Install & run

```bash
npm install                      # from repo root — installs all workspaces

# Development build (needed for native modules):
cd admin-app && npx expo run:android      # local (requires Android SDK + JDK 17)
#   or, cloud build (recommended):
npx eas-cli@latest build --profile development --platform android
npx expo start                   # then open the dev build

# same for buyer-app
```

## Deploy security rules & indexes

```bash
npm i -g firebase-tools
firebase login
firebase use <your-project-id>   # or edit .firebaserc
firebase deploy --only firestore:rules,firestore:indexes
```

## First-run: create a superuser

Roles live in Firestore `users/{uid}`. After you sign in once with Google (so your uid
exists in Auth), create this document in the Firebase console:

```
users/<your-uid> = {
  email: "you@example.com",
  name: "You",
  role: "superuser",
  shopId: "main",
  active: true
}
```

Reload the admin app — you'll have full access. From there, add more `users/{uid}` docs
(or build it out) to assign the other roles. Create the shop in **Settings** (or it's
created on first save).

## Roles

| Role | Can |
|------|-----|
| superuser | Everything (support/admin) |
| admin | Shop config, operating hours, sale discount, overrides, Fast2SMS key; read products/customers/orders/analytics |
| product-manager | View/add/edit products & categories |
| employee-manager | Add/remove/onboard employees |
| customer-manager | View/edit customers |
| sales | See incoming orders & serve them |
| analytics | Order history + sales trends + export |

The same permission keys are enforced in the UI (`common/src/roles`) and in
`firebase/firestore.rules`.

## Features

**Admin:** Google sign-in · role-gated dashboard · categories & products (image upload,
perishable flag, optional expiry, stock with skip-tracking flag, on-demand prep time,
**barcode-scan inventory** with an on-screen target box) · in-app **daily price/stock
reminders** · employee onboarding (details + photo + proof doc; onboarding token) ·
**customer view/edit + insights** (lifetime spend, order count, last order, top-spender sort) ·
**live incoming orders** with accept/serve · **POS** (in-store sales + printable bill) ·
coupons · analytics (date/product filters, revenue chart, order history) with **PDF & Excel
export** · **broadcast announcements** (compose a message/image + optional linked product,
pushed to all buyers) · **Feedback** screen (product reviews + delivery ratings; admin/superuser
only) · settings (shop, operating hours, sale discount, delivery zones, UPI, **subscription
minimum**, Fast2SMS key).

**Buyer:** Google sign-in · browse categories/products with relative expiry ("use by ~2
days"), on-demand prep time, stock/availability, and **average star rating in the list** ·
**"not accepting orders" banner** outside the shop's operating hours · **persistent cart** ·
checkout (delivery zones, coupons, COD/UPI) · **order history** with live status, **reorder**,
and **buyer cancel while still `new`** · **product subscriptions** — turn the cart into a
standing/scheduled order (one-time or daily/weekly, COD-only, free delivery, gated by the
admin's minimum) materialized into real orders by a cron · **ratings & reviews** (rate the
products *and* the delivery of a served order; reviews shown on the product page) ·
**announcement card** on Home · profile (addresses, phone, language, manage subscriptions,
sign out).

## Security

Read this before going beyond a prototype.

- **Fast2SMS key (accepted risk).** The key is stored in Firestore (`secrets/fast2sms`) by an
  admin and read by the **buyer app** at OTP send-time. This exposes a third-party secret to
  untrusted devices — any signed-in buyer can read it. You accepted this trade-off to stay on
  Spark. The send call sits behind the one-file `OtpSender` interface in `common/src/otp`, so
  the fix is a drop-in: host a tiny **free** serverless endpoint (Cloudflare Workers / Supabase
  Edge / Vercel) that holds the key, point a new sender at it, and restrict `secrets` reads to
  none. No app rewrite.
- **OTP is dev-grade.** Codes are stored short-lived in Firestore with an expiry + attempt cap.
  For production, move generation/verification server-side.
- **Reviews are verified client-side.** Buyers rate products from their own past orders, and
  Security Rules pin each review to the writer's uid at the deterministic id `${productId}_${uid}`
  (one per buyer per product, 1–5 rating). A direct-write bypassing the app can still forge the
  display name; harden server-side if that matters.

## Known limitations / upgrade paths

- **Images are base64 in Firestore** (to stay on free Spark). The admin compresses/resizes
  before upload, but Firestore caps a document at 1 MB — very large images are rejected with a
  clear error. If you later outgrow this, flip to Cloud Storage (Blaze) or a free file host and
  swap the `putImage`/`useCachedImage` pair; nothing else changes.
- **Push + email are built via a free Cloudflare Worker** (`functions/notify`, FCM HTTP v1 +
  Gmail API) — so the Firebase project stays on **Spark** with no Cloud Functions. The Worker
  handles `new-order` (rings order-servers), `order-status`, `back-in-stock`, `broadcast`
  (announcements → all buyers), and `email`; a **per-minute cron** re-rings stale unpicked
  orders and **materializes due product subscriptions into orders**. It needs a one-time
  `wrangler deploy`. In-app real-time listeners still cover live updates while an app is open.
- **UPI is not auto-charged**, so **subscriptions are Cash-on-Delivery only** (the buyer is told
  this before subscribing).
- **Operating-hours timezone:** comparisons use device local time; the stored timezone is
  informational. Subscription fire times are stored as absolute timestamps computed on-device,
  so the Worker needs no timezone math.
- **Single shop** (`shopId: "main"`); the data model carries `shopId` so multi-shop is a
  smaller step later.
- iOS: configs are Android-first; add `ios` bundle IDs + `GoogleService-Info.plist` to extend.

## License & reuse

> ⚠️ **Attribution required.** This app was created by **Muhil Kennedy**. If you
> clone, fork, redistribute, or deploy this app — or a substantial portion of it,
> including any copy obtained from this Git repository — you **must** keep visible
> credit to the original author: **`made by Muhil Kennedy`**. This line is shown in
> the app's Profile (buyer) and Settings (seller) screens and must remain present and
> legible in any derivative or redistributed build.

The underlying Expo framework/template code is MIT-licensed (see
[`admin-app/LICENSE`](admin-app/LICENSE) and [`buyer-app/LICENSE`](buyer-app/LICENSE),
where the full attribution clause is reproduced). The attribution requirement above is
an additional, project-specific condition of reuse.
