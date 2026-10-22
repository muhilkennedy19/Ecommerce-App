# First-time setup & deploy guide

A complete, ordered walkthrough to take this repo from a fresh clone to both apps running
on an Android device/emulator, with Google Sign-In and Firestore working. Every step here
was validated end-to-end; the **Troubleshooting** section at the bottom lists the exact
errors you may hit and their fixes.

> Backend model: **Firebase on the free Spark plan** — Google Sign-In + Cloud Firestore,
> no Cloud Functions, no Cloud Storage (images are base64 in Firestore), no billing.

---

## 0. Tools you need

- **Node 18+** and **npm 9+** (`node -v`, `npm -v`).
- **JDK 17** — Android's Gradle needs exactly 17, even if you have a newer JDK installed.
  macOS: `brew install --cask temurin@17`. The build scripts auto-select it.
- **Android SDK** — install **Android Studio** (gives the SDK, `adb`, and an emulator).
  The scripts auto-detect `~/Library/Android/sdk`; otherwise set `ANDROID_HOME`.
- A **Google account** to own the Firebase project.

Run `npm run doctor` any time to check this toolchain.

---

## 1. Install dependencies

```bash
npm install        # from the repo root — installs all three workspaces
```

---

## 2. Create the Firebase project

1. https://console.firebase.google.com → **Add project** → name it → create.
2. You do **not** need Google Analytics, Blaze, Storage, or App Check (see Notes).

---

## 3. Register the TWO Android apps + download `google-services.json`

This app ships **two** Android binaries, so you register **two** Android apps in the
**one** Firebase project (they share the same Firestore/Auth — see the README for why).

For **each** package below: Firebase Console → **Add app → Android** → enter the package
name → register → **download `google-services.json`** → place it at the path shown.

| App | Android package name | Put `google-services.json` at |
|-----|----------------------|-------------------------------|
| Admin (seller) | `com.ecommerce.admin` | `admin-app/google-services.json` |
| Buyer (customer) | `com.ecommerce.buyer` | `buyer-app/google-services.json` |

(The "app nickname" is just a label. Only the package name must match exactly. These files
are git-ignored — never commit them.)

---

## 4. Enable Google Sign-In

Firebase Console → **Authentication → Get started → Sign-in method** → **Google** →
**Enable** → choose a support email → **Save**.

This auto-creates the OAuth **Web client ID** the app needs. Find it under the same Google
provider panel → **Web SDK configuration → Web client ID**, or inside either freshly
re-downloaded `google-services.json` (the `oauth_client` entry with `client_type: 3`).

---

## 5. Register the signing SHA-1 fingerprint  ← the #1 gotcha

Google Sign-In rejects the app with **`DEVELOPER_ERROR`** unless the **signing
certificate's SHA-1** is registered in Firebase. There are two different signing keys
depending on how you build — register whichever you use (you can add several per app):

- **Release APK built locally** (`npm run apk:admin` / `scripts/build-apk.sh … release`):
  Expo signs it with its **own bundled debug keystore** (NOT `~/.android/debug.keystore`).
  This keystore is deterministic across all Expo projects, so its SHA-1 is stable and the
  same for both apps.
- **Dev build via `npx expo run:android`**: signed with your machine's
  `~/.android/debug.keystore`.

**Get the SHA-1 of a built APK** (works for any APK, reliable):
```bash
APKSIGNER="$(ls ~/Library/Android/sdk/build-tools/*/apksigner | sort -V | tail -1)"
"$APKSIGNER" verify --print-certs <path-to>.apk | grep -i SHA-1
```
Format the 40 hex chars as colon-separated uppercase pairs, e.g.
`5E:8F:16:06:…:F6:25`.

**Register it:** Firebase Console → **Project settings** → **Your apps** → pick the Android
app → **Add fingerprint** → paste → **Save**. Do it for **both** `com.ecommerce.admin` and
`com.ecommerce.buyer`. Wait ~1–2 minutes to propagate. No reinstall needed — the fingerprint
is validated server-side.

> You do NOT need to re-download `google-services.json` after adding a fingerprint — the app
> passes the Web client ID at runtime, and adding the fingerprint creates the matching
> Android OAuth client server-side, which is all `DEVELOPER_ERROR` needs.

---

## 6. Configure the apps

For **each** of `admin-app/app.json` and `buyer-app/app.json`, fill `expo.extra`:

```jsonc
"extra": {
  "firebase": {
    "apiKey":            "…",                 // from google-services.json: api_key.current_key
    "authDomain":        "<projectId>.firebaseapp.com",
    "projectId":         "…",                 // project_info.project_id
    "storageBucket":     "…",                 // project_info.storage_bucket
    "messagingSenderId": "…",                 // project_info.project_number
    "appId":             "…"                  // THIS app's client_info.mobilesdk_app_id
  },
  "googleWebClientId": "<project-number>-xxxx.apps.googleusercontent.com", // the Web client ID from step 4
  "shopId": "main"
}
```

All of these are **public** identifiers (safe to ship) — not secrets. `appId` differs per app;
everything else is the same across both. The `googleWebClientId` is the **same** for both.

---

## 7. Deploy Firestore security rules + indexes

```bash
npx firebase-tools login                 # one-time, opens a browser
# .firebaserc already targets the project; otherwise: npx firebase-tools use <projectId>
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

A brand-new Firestore denies **all** reads/writes until these rules are live — skipping this
makes the app look broken (every query is permission-denied). The deploy also creates the
Firestore database on first run if it doesn't exist.

---

## 8. Build & install

Check the toolchain first: `npm run doctor`.

**Option A — dev loop** (compiles, installs, starts Metro; needs Metro running to use):
```bash
emulator -avd <your-avd>     # or launch from Android Studio Device Manager
npm run android:admin        # or android:buyer
```

**Option B — standalone release APK** (JS bundled, runs without Metro — good for drag-drop):
```bash
npm run apk:admin            # → admin-app/android/app/build/outputs/apk/release/app-release.apk
npm run apk:buyer            # → buyer-app/android/app/build/outputs/apk/release/app-release.apk
```
Drag the `.apk` onto a running emulator to install. (These are debug-signed with the Expo
keystore from step 5, so Google Sign-In works once that SHA-1 is registered.)

---

## 9. Bootstrap your superuser  (roles live in Firestore, not Authentication)

Roles are **not** set in Authentication → Users (that only lists identities). The role is a
**Firestore document** the app reads.

1. Launch the **admin** app, **Sign in with Google**. You'll see **"Access pending"** — expected.
2. Firebase Console → **Authentication → Users** → copy your account's **User UID**.
3. Firebase Console → **Build → Firestore Database** → **Start collection** → ID `users` →
   **Document ID = that UID** → add fields **with these exact types**:

   | Field | Type | Value |
   |-------|------|-------|
   | `email` | string | your email |
   | `name` | string | your name |
   | `role` | string | `superuser` |
   | `shopId` | string | `main` |
   | `active` | **boolean** | `true` |

   ⚠️ `active` **must be the boolean `true`**, not the string `"true"`, or writes (add
   category, save settings) are denied for non-superuser roles. `role` must be lowercase
   `superuser`. `shopId` must match `extra.shopId` (`main`).
4. Reopen / pull-to-refresh the admin app → full dashboard.
5. In **Settings**, create the shop + operating hours, then add a category and a product
   (with a photo — exercises the base64-image path).

---

## 10. Add more users / roles (in-app after the first superuser)

Only the **first superuser** is created by hand (step 9). After that, role management is in-app:
- A new staff member **signs into the admin app once** → they appear under **Team & Roles →
  Pending requests** (they self-register a `pendingUsers/{uid}` doc; they see "Access pending").
- A superuser / admin / employee-manager opens **Team & Roles** (dashboard card), picks a role,
  and taps **Grant** → creates their `users/{uid}` doc. From there you can change roles, toggle
  active, or remove (superuser only).
- **Escalation guards** (enforced in rules too): only a **superuser** can create/alter a
  superuser; managers can't change their own role or see superusers.
- Roles: `superuser`, `admin`, `product-manager`, `employee-manager`, `customer-manager`,
  `sales`, `analytics`. Employees (name/email/dob/photo/proof) are onboarded separately on the
  **Employees** screen — that's a profile record, distinct from the role grant above.

**Purge (superuser only):** dashboard → 🧹 **Purge data** wipes all products, orders, customers,
or users-except-you (double-confirmed) — handy for resetting between onboarding/test runs.

## 11. Push notifications (optional — free, stays on Spark)

Push is delivered by a tiny **Cloudflare Worker** (`functions/notify/`) that holds a Firebase
**service account** and sends via **FCM HTTP v1**. The apps register each device's FCM token and
POST events to the Worker. Everything works without it (the apps no-op when `notifyUrl` is empty).

1. **Service account:** Firebase Console → ⚙ Project settings → **Service accounts → Generate new
   private key** → download the JSON (secret; never commit).
2. **Confirm FCM:** Project settings → **Cloud Messaging** → *Firebase Cloud Messaging API (V1)*
   enabled (default).
3. **Deploy the Worker** (global `npm i -g wrangler` often fails on permissions — use `npx`):
   ```bash
   cd functions/notify
   npx wrangler login
   npx wrangler deploy
   # set the secret by piping the JSON FILE into stdin (NOT as an argument):
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < /path/to/service-account.json
   ```
   `wrangler deploy` prints a URL like `https://notify.<subdomain>.workers.dev`.
4. **Wire it:** put that URL in **both** `app.json → expo.extra.notifyUrl`, then **rebuild** the
   APKs (push adds the `expo-notifications` native module → a fresh build is required).
5. **On device:** open each app once and **grant the notification permission** — that registers
   the device token into `pushTokens/{uid}`. No token = no push.

Events: new order → employees' phones ring ~10 s (admin "orders" channel + bundled
`admin-app/assets/sounds/order_ring.wav`, generated by `scripts/gen-sound.mjs`); status change →
the customer; back-in-stock → buyers who tapped "Notify me". **Security caveat:** the Worker
currently checks the caller's ID-token *claims* only (not the signature) — low impact (sends only);
hardening path is in `functions/notify/README.md`.

## 11b. Transactional email — welcome + order bill (Gmail API, optional, free)

The same Cloudflare Worker also sends email via the **Gmail API**, using an OAuth2 **refresh
token** for one Gmail account (the "sender"). The apps call it through `sendEmail(...)` which POSTs
`{ event:'email', to, subject, text, html }`; it's a graceful no-op if the four `GMAIL_*` secrets
aren't set. Two emails are wired today:

- **Welcome email** — sent once, the first time a brand-new customer signs into the buyer app.
- **Order bill** — itemized receipt sent to the customer when the shop **accepts** their order.

Mailbox credentials live **only** as Worker secrets (server-side) — never in Firestore, `app.json`,
or the APK. Full step-by-step (do this once; all in [Google Cloud Console](https://console.cloud.google.com)
for the **same project** as Firebase):

1. **OAuth consent screen** → *APIs & Services → OAuth consent screen*. User type **External**,
   fill app name + support email + developer email, **Save**. Under **Audience** keep it in
   **Testing**, and add the sender Gmail address (and any test recipients) as **Test users**.
   *Testing mode is fine and free — see the 7-day caveat below.*
2. **Enable the Gmail API** → *APIs & Services → Library → "Gmail API" → Enable*.
3. **Create an OAuth client** → *APIs & Services → Credentials → Create credentials → OAuth client
   ID → Application type: **Web application***. Add Authorized redirect URI
   `https://developers.google.com/oauthplayground`. Save, then copy the **Client ID** and **Client
   secret**. (A *Web* client is required — the OAuth Playground can't use an Android client.)
4. **Mint a refresh token** → open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - Click the ⚙ (top-right) → tick **Use your own OAuth credentials** → paste the Client ID +
     secret from step 3.
   - Step 1: in the scope box enter `https://www.googleapis.com/auth/gmail.send` →
     **Authorize APIs**. Sign in as the **sender** Gmail account. You'll see *"Google hasn't
     verified this app"* — expected for a testing-mode app; **Advanced → Go to (app) → Allow**.
   - Step 2: **Exchange authorization code for tokens** → copy the **Refresh token**.
5. **Set the four Worker secrets** (interactive — it prompts *"Enter a secret value:"*, paste, Enter;
   nothing is echoed and nothing is pasted into the shell history):
   ```bash
   cd functions/notify
   npx wrangler secret put GMAIL_CLIENT_ID       # paste the Web client ID
   npx wrangler secret put GMAIL_CLIENT_SECRET   # paste the Web client secret
   npx wrangler secret put GMAIL_REFRESH_TOKEN   # paste the refresh token from step 4
   npx wrangler secret put GMAIL_SENDER          # the sender Gmail address, e.g. shop@gmail.com
   ```
6. **Redeploy the Worker** (secrets only take effect on the next deploy):
   ```bash
   npx wrangler deploy
   ```
   This single deploy also activates the role-scoped new-order notifications and the ~30 s
   re-reminder cron if you haven't deployed since those landed.
7. **Verify:** `npx wrangler tail` to watch live logs, then (a) sign in to the buyer app with a
   never-seen-before Google account → welcome mail arrives; (b) place an order and **Accept** it in
   the admin app → the buyer gets the itemized bill.

**⚠️ Testing-mode caveat (plan for it):** `gmail.send` is a Google *restricted* scope. While the
consent screen is in **Testing**, refresh tokens **expire after ~7 days** — email silently stops
until you redo step 4 and re-put `GMAIL_REFRESH_TOKEN`, then `npx wrangler deploy`. To make it
permanent you must **publish** the consent screen and pass Google's restricted-scope verification
(or use a Google Workspace domain with internal user type). The Worker contract, secrets, and
caveats are also documented in `functions/notify/README.md`.

## 12. Collections (Firestore)

`shops/{id}` · `users/{uid}` (roles) · `pendingUsers/{uid}` (role requests) · `categories` ·
`products` · `images/{id}` (base64 images) · `employees` · `customers` (addresses[], phone,
notifyBackInStock[]) · `orders` · `coupons/{CODE}` · `deliveryZones/{pincode}` (serviceable + fee +
freeAbove) · `pushTokens/{uid}` · `secrets/fast2sms` · `otps`.

---

## Troubleshooting (every error we actually hit)

| Symptom | Cause & fix |
|---------|-------------|
| **`DEVELOPER_ERROR`** on Google Sign-In | The installed APK's signing SHA-1 isn't registered. Extract it (step 5) and add it to **both** apps in Firebase. Wait 1–2 min. |
| App stuck on **"Access pending"** after sign-in | No role yet — grant one from **Team & Roles** (or, for the first superuser, create the `users/<uid>` doc, step 9). The UID is the **Google** account's UID. |
| **"No permission"** writing as a non-superuser | `active` is the string `"true"` instead of the boolean `true`, so the rules' active check fails. Fix the field type in Firestore. (Superuser bypasses this.) |
| Everything is **permission-denied** right after setup | You didn't deploy the security rules (step 7). |
| `wrangler: command not found` | Global install failed — use `npx wrangler …`. |
| `wrangler secret put` → *Unknown argument* | Don't pass the file as an arg; pipe it: `npx wrangler secret put NAME < file.json`. |
| Push never arrives | Open the app once post-install + grant notification permission (registers the token); confirm the Worker secret is set and `notifyUrl` is in `app.json`; rebuild after setting `notifyUrl`. |
| Email (welcome/bill) never arrives | Confirm all four `GMAIL_*` secrets are set **and** you ran `npx wrangler deploy` after setting them; check the recipient account has an email on file; `npx wrangler tail` to see the Gmail error. Most common cause after a week: the testing-mode refresh token expired (~7 days) — redo step 4 of §11b and re-put `GMAIL_REFRESH_TOKEN`, then redeploy. |
| `expo install X` → *No matching version … before <date>* | The pinned registry lacks that version. Pin an available version or drop the dep (we hit this with `expo-localization` — localization uses a custom AsyncStorage switcher instead). |
| Build fails: **`getReactNativePersistence is not a function`** | Already fixed (Firebase init deferred to runtime; `web.output` is `static`). Don't call `initFirebase()` at module top level. |
| Build fails: **`TASK: unbound variable`** / odd script errors | Don't paste "smart" punctuation (`…`, em-dashes) next to shell variables. |
| Firebase Storage asks to **upgrade to Blaze** | Expected — this app doesn't use Storage (images are base64 in Firestore). Skip it. |
| Console banner about **Firebase Dynamic Links** shutting down | Irrelevant — only affects email-link auth / Cordova OAuth, which this app doesn't use. |
| Firestore console nudges **App Check** | Optional; leave it **off**. The JS SDK has no Play Integrity provider, so enforcing it would break the app. |

---

## What NOT to do

- Don't hand-edit `android/` or `ios/` — they're generated by `expo prebuild` and git-ignored.
  Configure native behavior via `app.json`.
- Don't commit `google-services.json` or any keystore (already git-ignored).
- Don't ship real third-party secrets in the app (the Fast2SMS key is a documented,
  accepted exception — see README → Security).
