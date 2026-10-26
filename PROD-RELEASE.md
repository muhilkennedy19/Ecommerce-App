# Production Release — Google Play

Release runbook for the two Android apps in this monorepo. Covers what has already
been done, what is still outstanding, and how to cut future releases.

| | buyer-app | admin-app |
|---|---|---|
| Play package | `com.ecommerce.buyer` | `com.ecommerce.admin` |
| Display name | Buyer | Seller |
| EAS project | `@mkencom/buyer-app` | `@mkencom/admin-app` |
| EAS project id | `19acf35d-c07b-4175-b8da-de7ca354f9c5` | `77dc3e89-717f-45df-ad4e-818b13d7c57a` |
| Keystore (EAS) | `egmE8q4QDu` (default) | generated on first build |
| AAB built | ✅ | ✅ |
| Keystore backed up | ✅ | ✅ |
| SHA-1 in Firebase | ⬜ | ⬜ |
| Uploaded to Play | ⬜ | ⬜ |

Shared backend: Firebase project `ecommerce-rajendran` (Spark plan) + a Cloudflare
Worker for push/email. Source: <https://github.com/muhilkennedy19/Ecommerce-App> (public).

**Next action:** register / reinstate the Play developer account (§6.0), upload both
AABs to Internal testing, then complete the fingerprint cycle in §5 and rebuild.

---

## 1. Local toolchain

Node was installed from the official macOS `.pkg`, so npm's global prefix was
`/usr/local` (root-owned) and `npm i -g` failed with `EACCES`. Fixed by moving the
prefix to a user-owned directory rather than `chmod`-ing system paths:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
# appended to ~/.zshrc and ~/.bash_profile:
export PATH="$HOME/.npm-global/bin:$PATH"

npm install -g eas-cli
```

> `eas` is only on the PATH of shells that source those profiles. In a bare
> `sh-3.2$` shell run `source ~/.bash_profile` first, or use `npx eas-cli@latest`.

Other requirements: JDK 17 (`scripts/_common.sh` auto-detects it) and the Android
SDK — only needed for local Gradle builds, not for EAS Build.

---

## 2. Keeping secrets out of the public repo

The repository is public, so private values must never land in a tracked file.

### The `app.config.js` pattern

Each app has an `app.config.js` that layers private values on top of `app.json`:

```
app.json                  → committed, public config (icons, plugins, Firebase keys)
app.local.json            → GITIGNORED, holds notifyUrl locally
app.local.example.json    → committed template
app.config.js             → committed, merges the above + EAS env vars
```

Resolution order for a value: **EAS env var → `app.local.json` → `app.json`**.

| Value | Local source | EAS Build source |
|---|---|---|
| `extra.notifyUrl` | `app.local.json` | env var `NOTIFY_URL` (string) |
| `android.googleServicesFile` | `./google-services.json` | env var `GOOGLE_SERVICES_JSON` (file) |

Both degrade safely: if nothing supplies `notifyUrl` the app still builds and
push/email become a no-op (`common/src/util/notify.ts` short-circuits on an empty URL).

### Why EAS needs the env vars

**EAS Build only uploads files tracked by git.** `google-services.json` and
`app.local.json` are both gitignored, so the builder cannot see them. The first
production build failed with:

```
"google-services.json" is missing, make sure that the file exists.
Remember that EAS Build only uploads the files tracked by git.
```

Fixed by uploading them as EAS environment variables (see §3).

### `.gitignore` additions

`*.jks`, `*.p8`, `*.p12`, `*.key`, `**/service-account*.json`, `.env*.local`,
`.dev.vars`, `.wrangler/`, `**/app.local.json`, `.idea/`, `.vscode/`.

> ⚠️ Tooling has twice rewritten the resolved config back into `app.json`,
> re-introducing `notifyUrl`. **Before every commit** run:
> ```bash
> git diff --cached | grep -i "workers.dev" && echo "STOP — URL leaked"
> ```

### What *is* public, deliberately

`apiKey`, `appId`, `messagingSenderId` and `googleWebClientId` in `app.json` are
public by design — Firebase security comes from Auth + Firestore rules, not from
hiding these. Do not waste effort concealing them; harden the rules instead (§7).

---

## 3. EAS setup (per app)

```bash
cd <app>

eas init          # interactive; writes extra.eas.projectId into app.json

eas env:set --scope project --name GOOGLE_SERVICES_JSON --type file \
  --value ./google-services.json --visibility sensitive \
  --environment production --environment preview --environment development \
  --non-interactive

eas env:set --scope project --name NOTIFY_URL --type string \
  --value "<worker-url>" --visibility sensitive \
  --environment production --environment preview --environment development \
  --non-interactive

eas env:list --environment production   # verify both exist
```

Add `--force` to overwrite an existing variable.

`eas.json` build profiles (identical for both apps):

```json
{
  "cli": { "version": ">= 25.3.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview":      { "distribution": "internal" },
    "production":   { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

`appVersionSource: remote` + `autoIncrement` means EAS owns `versionCode` and bumps
it server-side on every production build. Do **not** also hand-edit `versionCode`.

---

## 4. Building

```bash
cd <app>
eas build -p android --profile production     # → .aab for Play
```

Local APK builds (sideloading/testing only, never for Play) still work via
`./scripts/build-apk.sh <admin|buyer> [debug|release]`. Note that script's release
output is **debug-signed** and is not uploadable.

### Expected warnings — all benign

| Warning | Why it is fine |
|---|---|
| `your app uses Expo Go for development` | Fires because `expo-dev-client` isn't a dependency. Irrelevant to a standalone production build; this app can't run in Expo Go anyway (native Google Sign-In, custom notification sound). Silence with `EAS_BUILD_NO_EXPO_GO_WARNING=true`. |
| `googleServicesFile ... is not checked in to your repository` | Emitted during *local* config evaluation, where the env var isn't set so it falls back to the untracked path. On the builder the file variable is materialised and used. The Google Services Gradle plugin hard-fails if the file is truly missing — a successful build proves it resolved. |
| `Environment variables ... loaded: NOTIFY_URL` (no `GOOGLE_SERVICES_JSON`) | File-type variables are deliberately not downloaded to your machine, so they're absent from that list. |
| `Incremented versionCode from N to N+1` | Remote versioning working as configured. |

---

## 5. Signing & SHA-1 — the step that breaks Google Sign-In

EAS generates and stores the upload keystore. Read its fingerprints with:

```bash
eas credentials -p android     # → production → the summary already prints SHA1
```

The summary screen shows the SHA-1 immediately; just copy it and choose **Go back**.

### Backing up the keystore

EAS **generated** this keystore server-side during the first production build — it was
not created locally with `keytool`, and there is no local copy. Download it with:

```
eas credentials -p android
  → production
  → Keystore: Manage everything needed to build your project
  → Download existing keystore
```

This writes a `.jks` into the current directory and prints the **key alias, keystore
password and key password** to the terminal. The `.jks` is worthless without those
three values — store them together in a password manager, not in the repo
(`*.jks` and `credentials.json` are gitignored, but do not rely on that).

> How bad is losing it? Less bad than it sounds, because Play App Signing is
> mandatory for new apps: Google holds and backs up the real **app signing key**, and
> your keystore is only the **upload key**. A lost upload key can be reset by
> requesting it through Play Console support. Backing it up avoids that support
> round-trip and keeps you able to build in the meantime — it is prudent, not
> existential.


### Why this matters

Google Sign-In validates the app's signing certificate against the fingerprints
registered in Firebase. `google-services.json` currently contains only
`certificate_hash: 2970f5bc…`, which is the **Expo debug keystore**. A Play build
signed with a different key will install and launch fine, then fail at sign-in with
`DEVELOPER_ERROR` — and since both apps gate everything behind sign-in, the app is
completely unusable.

### Three certificates end up involved

1. **Expo debug keystore** — local dev builds. Already registered.
2. **EAS upload key** — signs the AAB you upload. Get the SHA-1 from `eas credentials`.
3. **Play App Signing key** — Google re-signs your bundle with this before
   distributing. Its SHA-1 only appears *after* your first upload, under
   Play Console → Setup → App signing.

**All three must be registered**, per package, in
Firebase Console → Project settings → Your apps → Add fingerprint.

### After adding fingerprints

```bash
# 1. re-download google-services.json from Firebase into the app folder
# 2. re-upload it to EAS
eas env:set --scope project --name GOOGLE_SERVICES_JSON --type file \
  --value ./google-services.json --visibility sensitive \
  --environment production --environment preview --environment development \
  --force --non-interactive
# 3. rebuild — fingerprints are baked in at build time
eas build -p android --profile production
```

### Credentials not needed

`eas credentials` also lists these as unassigned; both are optional here:

- **Push Notifications (FCM V1) service account** — only needed for Expo's push
  service. This project calls FCM HTTP v1 directly from its own Cloudflare Worker,
  so it is not required.
- **Google Service Account Key for Play Store Submissions** — only needed for
  `eas submit`. Manual upload works without it.

---

## 6. Play Console

### 6.0 Prerequisite — developer account

<https://play.google.com/console> → **Create developer account** → **Personal**
(vs Organization). US$25 one-time, non-refundable, non-transferable between accounts.
Requires government-ID identity verification, which for personal accounts commonly
takes several days. **Nothing else here can proceed until it clears**, so start it early.

> **If an existing account shows "closed because it was not being used":** that is
> Google's inactive-account policy (no published app, idle ~12 months). It is *not*
> a policy violation, so — unlike a violation-based termination — registering again
> is permitted.
>
> Order of preference:
> 1. **Appeal for reinstatement** using the link in the closure email, or Play Console
>    → Help & feedback → Contact support. Free, and preserves the $25 already paid.
>    Stating that apps are ready to publish helps.
> 2. **Use another account** that is in good standing — nothing in this repo is tied
>    to a particular Play account.
> 3. **Register fresh** (another $25 + re-verification).
>
> The appeal is worth attempting first for a reason beyond the fee: newly registered
> personal accounts are subject to the 12-testers/14-days closed-testing requirement
> (§6.4), while an older reinstated account may predate it.

### 6.1 Get the `.aab` files

```bash
cd <app>
eas build:list --platform android --limit 3     # prints artifact URLs

mkdir -p ~/Desktop/play-uploads
curl -L -o ~/Desktop/play-uploads/<app>-v<N>.aab "<artifact-url>"
```

Or use the **Download** button on the build's page at expo.dev.

### 6.2 Create each app

**All apps → Create app**. Do this twice — these are two independent Play listings.

| Field | buyer-app | admin-app |
|---|---|---|
| App name | Buyer | Seller |
| Default language | English (India) | English (India) |
| App or game | App | App |
| Free or paid | Free | Free |

The package name is **never typed in** — Play reads `com.ecommerce.buyer` /
`com.ecommerce.admin` from the AAB on first upload and it is permanent thereafter.
Uploading the wrong bundle to a listing cannot be undone; the listing must be abandoned.

### 6.3 Upload to Internal testing

**Test and release → Testing → Internal testing → Create new release**

1. On the first release Play offers **Play App Signing** — accept. This generates the
   app signing key whose SHA-1 is required in §5.
2. Drag in the `.aab`. The release name auto-fills from `versionCode`.
3. Add release notes.
4. **Next → Save → Review release → Start rollout to Internal testing**.

Then **Testers** tab → **Create email list** → add tester Gmail addresses → save →
copy the **opt-in URL**. Testers must open that link and accept before the listing
becomes visible to them.

### 6.4 Store listing & declarations

Play flags these under **Dashboard → Set up your app**. Internal testing tolerates
some gaps; all are mandatory before closed/production, so complete them once.

- [ ] Store listing: title, short + full description, screenshots,
      512×512 icon, 1024×500 feature graphic
- [ ] **Privacy policy URL** — mandatory; the apps collect name, email, phone, address
- [ ] **Data safety** form — declare: name, email, phone, delivery address,
      purchase history, device push token
- [ ] Content rating questionnaire
- [ ] Target audience & ads declaration (no ads)
- [ ] **App access** — both apps are fully login-gated, so the reviewer *must* be given
      working test credentials. For admin-app the test account also needs a role
      pre-assigned in `users/{uid}`, otherwise the reviewer only ever sees the
      "waiting for approval" screen and the submission is rejected.
- [ ] **Closed testing**: accounts registered after Nov 2023 must run 12+ testers for
      14 continuous days before Production unlocks

`targetSdkVersion` is already 35, which satisfies the current Play requirement.

### 6.5 After the first upload

**Test and release → Setup → App signing** now shows two certificates:

- **App signing key certificate** — what users' installs are actually signed with.
  **This SHA-1 must go into Firebase** (§5).
- **Upload key certificate** — matches the EAS keystore.

Feed both into §5, rebuild, and re-upload.

### 6.6 Verifying

Install via the **internal-testing opt-in link**, not by sideloading. A sideloaded
build is signed with the upload key rather than Play's app signing key, so it
exercises a different certificate path than what users receive — Google Sign-In can
pass or fail differently.

### Distribution note for admin-app

admin-app is a staff-only tool. A public Production listing invites install attempts
by customers who can never get a role. Prefer **Internal testing**, **Closed testing**,
or a **managed Google Play private app** instead.

---

## 7. Must fix before the Production track

These are known, pre-existing issues — none block an Internal-testing upload, all
should be resolved before a public release.

1. **The notify Worker does not verify the ID-token signature.** It checks only the
   `aud`/`iss`/`exp` claims, so anyone who learns the Worker URL can forge a token
   and trigger arbitrary push notifications and emails. Verify against Google's
   public JWKs, or put the Worker behind Cloudflare Access / a shared secret.
   *Removing the URL from the repo does not mitigate this* — the URL is also baked
   into every distributed binary.
2. **`secrets/fast2sms` is readable by any signed-in user** per `firestore.rules`.
   Move the key to a Worker secret and delete the Firestore document.
3. **OTP codes are generated and verified client-side**, stored in a Firestore
   collection readable by signed-in users. Move server-side or drop the feature.
4. **Firestore rules are the only real access control** — roles live in documents,
   not custom claims, and the client-side permission checks are UX only. Re-read
   `firebase/firestore.rules` before launch.

---

## 8. Backend deploy (independent of the store)

```bash
# Firestore rules + composite indexes
firebase deploy --only firestore:rules,firestore:indexes

# Cloudflare Worker
cd functions/notify
wrangler secret put FIREBASE_SERVICE_ACCOUNT    # paste the service-account JSON
wrangler secret put GMAIL_CLIENT_ID
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put GMAIL_REFRESH_TOKEN
wrangler secret put GMAIL_SENDER
wrangler deploy
```

If the Worker URL ever changes, update `app.local.json` **and** the `NOTIFY_URL`
EAS variable (with `--force`) for both apps, then rebuild.

---

## 9. Routine release checklist

For every subsequent release:

1. `git pull` and confirm a clean tree
2. Verify no secrets are staged: `git diff --cached | grep -i "workers.dev"`
3. Bump `expo.version` in `app.json` (the user-visible version; `versionCode` is automatic)
4. `eas build -p android --profile production`
5. Download the `.aab` and upload to Internal testing
6. Smoke test on a real device — **especially Google Sign-In**, which is what breaks
   when fingerprints drift
7. Promote through Closed testing → Production
8. Deploy any matching Firestore rules / Worker changes **before** promoting

---

## Appendix — architecture reference

See [docs/architecture.drawio](docs/architecture.drawio) (open with the Draw.io
Integration extension). Six pages: System Architecture, Order Lifecycle,
Push & Email Pipeline, Auth & RBAC, Firestore Data Model, and Build & Release Pipeline.
