# notify — free external push sender (Cloudflare Worker)

A tiny Cloudflare Worker that sends push notifications through **FCM HTTP v1**.
It exists so the Firebase project can stay on the **free Spark plan** — all the
"server" work (reading Firestore, minting tokens, calling FCM) happens here
instead of in paid Cloud Functions.

- **No npm runtime dependencies.** Pure Web Crypto + `fetch`.
- Talks to Firebase entirely over REST (Firestore REST + FCM HTTP v1).
- Project id, FCM config, etc. all come from the service-account JSON — there is
  **nothing else to configure**.

## Request contract

`POST` only (anything else → `405`). Every request must carry the caller's
Firebase ID token:

```
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

Body is one of:

| `event`          | Fields                                  | Who gets notified |
| ---------------- | --------------------------------------- | ----------------- |
| `new-order`      | `shopId`, `orderId`                     | order-servers only: `pushTokens/*` with `kind == 'admin'` **and** `role` in `sales` / `admin` / `superuser` (tokens with no `role` or any other value are excluded) — high-priority `orders` channel, `order-ring` sound, so their phone rings. Title **New order**, body *A new order just came in — tap to view*. |
| `order-status`   | `customerId`, `status`, `orderId?`      | `pushTokens/{customerId}`. Title **Order update**, body *Your order is now `${status}`*. Default channel/sound. |
| `back-in-stock`  | `shopId`, `productId`, `productName?`   | every customer with `productId` in their `customers/{uid}.notifyBackInStock` array → each of their `pushTokens/{uid}`. Title **Back in stock**, body *`${productName \|\| 'An item'}` is back in stock*. Default channel/sound. |
| `email`          | `to`, `subject`, `text`, `html?`        | sends a real email via the **Gmail API** (not a push). See [Email event](#email-event-gmail-api) below. |

Response is always JSON:

```json
{ "sent": 3, "failed": 1 }
```

Per-token failures (e.g. `UNREGISTERED`, stale tokens) are counted in `failed`
and never fail the whole batch. Error responses: `400` (bad body), `401` (bad /
missing auth), `500` (missing/invalid secret), `502` (upstream Google error).

> The `email` event returns a different shape — see below — and can also return
> `503` when the Gmail secrets are not configured.

## Email event (Gmail API)

`{ "event": "email", "to", "subject", "text", "html?" }` sends an actual email
through the **Gmail API** instead of a push notification. Like every other
event it still requires a valid `Authorization: Bearer <Firebase ID token>`
(same claim-check as above).

- `to`, `subject`, `text` are **required** → `400` if any is missing.
- `html` is optional. When present, the message is sent as `text/html` (and the
  `html` body is used); otherwise `text` is sent as `text/plain`. Both use
  `charset="UTF-8"`.
- The message is built as an RFC 2822 message (CRLF line breaks, blank line
  between headers and body), base64url-encoded, and POSTed to
  `users/me/messages/send`.

Response:

```json
{ "sent": true, "id": "18f..." }   // 200 on a Gmail 2xx
{ "sent": false, "error": "..." }  // 502 with the Gmail/OAuth error text
```

If the Gmail secrets below are not all set, the event returns
`503 { "error": "email not configured" }`.

### Gmail secrets

The Gmail path authenticates with its own **OAuth refresh-token** credentials,
stored as four Worker secrets (independent of `FIREBASE_SERVICE_ACCOUNT`):

```bash
cd functions/notify
npx wrangler secret put GMAIL_CLIENT_ID       # OAuth client id
npx wrangler secret put GMAIL_CLIENT_SECRET   # OAuth client secret
npx wrangler secret put GMAIL_REFRESH_TOKEN   # refresh token with the gmail.send scope
npx wrangler secret put GMAIL_SENDER          # authorized sender address (From: header)
```

At request time the Worker exchanges the refresh token for a short-lived access
token at `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`), then
calls the Gmail API with it.

### Restricted-scope caveat (refresh token expiry)

`https://www.googleapis.com/auth/gmail.send` is a Google **"restricted" scope**.
While your OAuth consent screen is in **testing** mode, refresh tokens for
restricted scopes **expire after ~7 days** — after which the `email` event will
start failing (`502`) and you must mint a fresh `GMAIL_REFRESH_TOKEN` and
re-`put` the secret. To make it permanent you must **publish** the consent
screen and go through Google's **verification** (which for restricted scopes can
require a security assessment).

### Activating

As with any secret/code change, you must re-deploy for it to take effect:

```bash
cd functions/notify
npx wrangler deploy
```

## Re-reminder sweep (cron / `scheduled` handler)

A `new-order` only rings the employees **once**. If nobody accepts or rejects
it, that single ring can be missed. To cover that, the Worker also runs a
cron-triggered **re-reminder sweep** (the `scheduled` handler).

On every tick it:

1. Mints an access token and `:runQuery`s `orders` where `status == 'new'`.
2. For each such order, computes its age from `createdAt` and only acts if it
   has been waiting **more than ~30 seconds** (nobody accepted/rejected yet).
3. Reads an integer `reminders` field (default `0`) and **skips** the order once
   `reminders >= 15` — a safety cap so an order can never ring forever (stops
   after ~15 re-rings).
4. Re-sends the **same** high-priority `orders`-channel ring (`order_ring`
   sound) to the same order-server recipients as `new-order` — title **New order
   still waiting**, body *An order hasn't been picked up yet — tap to view*.
5. PATCHes the order doc (Firestore `updateMask`) to set `reminders` to
   `reminders + 1` and `lastRemindedAt` to now.

Per-order failures are swallowed, so one bad order never aborts the batch. The
re-ring repeats every tick until the order leaves `status == 'new'` (accepted
or rejected) or hits the cap.

### ~1-minute cron granularity caveat

The threshold is **~30 seconds**, but Cloudflare's **minimum cron interval is 1
minute** (`crons = ["* * * * *"]` in `wrangler.toml`). So the first re-ring
fires within **~1 minute** of an order being placed — not exactly at 30s — and
then again each following minute until the order is handled or the `reminders`
cap is reached. Cron triggers are **free** on Cloudflare (no Workers paid plan
required).

### Activating the cron

The cron is defined under `[triggers]` in `wrangler.toml`, but adding it to the
file is not enough — you must **re-deploy** for Cloudflare to register it:

```bash
cd functions/notify
npx wrangler deploy
```

Orders it reads/writes: `orders/{id}` with `status` (string), `createdAt`
(timestamp), and the `reminders` (integer) / `lastRemindedAt` (timestamp) fields
the sweep maintains.

## Firestore data it reads

- `pushTokens/{uid}` = `{ token: string /* FCM device token */, kind: 'admin' | 'buyer', role?: 'sales' | 'admin' | 'superuser' | ... }`
- `customers/{uid}` may have `notifyBackInStock: string[]` (product ids)

> **Order notifications target order-servers only.** The `new-order` event and
> the re-reminder sweep both resolve recipients via `getAdminRecipients`, which
> now includes a token **only** when `kind == 'admin'` **and** its `role` is one
> of `sales` / `admin` / `superuser`. Tokens whose `role` is absent or any other
> value are excluded. The admin app writes this `role` into each
> `pushTokens/{uid}` doc. This change only takes effect once you **re-deploy**
> the Worker:
>
> ```bash
> cd functions/notify
> npx wrangler deploy
> ```


## Deploy

You need the Firebase **service-account JSON** (Firebase console → Project
settings → Service accounts → *Generate new private key*).

```bash
npm i -g wrangler          # one-time
wrangler login             # opens a browser, authorises your Cloudflare account
cd functions/notify
wrangler deploy            # uploads the Worker, prints the public URL
```

Then set the one secret (paste the entire service-account JSON when prompted):

```bash
wrangler secret put FIREBASE_SERVICE_ACCOUNT
# paste the contents of the service-account .json, then press Enter / Ctrl-D
```

Re-running `wrangler deploy` is safe; the secret persists across deploys.

### Wire the URL into the apps

`wrangler deploy` prints a URL like
`https://notify.<your-subdomain>.workers.dev`. Put it into **both** apps:

- `admin-app/app.json` → `expo.extra.notifyUrl`
- `buyer-app/app.json` → `expo.extra.notifyUrl`

(Both are currently `""`.) Rebuild/republish the apps so the new config ships.

That's it — no other Worker config is required. The Firebase `project_id` is
read from the service-account JSON, so the same deploy works for any project.

## Local dev

```bash
cd functions/notify
npm install          # dev-only tooling (wrangler, types, tsc)
npm run typecheck    # tsc --noEmit
wrangler dev         # local runtime; still needs the secret:
                     #   wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

## Security caveat — ID-token signature is NOT verified (claim-check only)

The Worker authenticates the caller's Firebase ID token by checking the
standard claims only:

- `aud === <project_id>`
- `iss === https://securetoken.google.com/<project_id>`
- `exp * 1000 > Date.now()`
- a non-empty `sub`

It does **not** cryptographically verify the RS256 signature. Firebase
publishes the signing keys only as **X.509 PEM certificates**
(`.../x509/securetoken@system.gserviceaccount.com`), and the Web Crypto API
cannot import an X.509 certificate directly — it only accepts a raw
`SubjectPublicKeyInfo` (`spki`). Extracting the SPKI from the certificate needs
ASN.1/DER parsing we can't do reliably without an npm dependency, so rather than
ship a fragile hand-rolled parser that might reject legitimate users, the code
gates on the claims above. See the `// TODO: verify signature for production`
note in `src/index.ts`.

**Implication:** a forged token with the right `aud`/`iss`/`exp` would pass.
Because the endpoint only *sends notifications* (no data is returned to the
caller and nothing is mutated) the blast radius is limited to spurious push
messages, but you should close this before relying on it for anything
sensitive.

**To harden for production:** import the Firebase signing key via the **JWK**
endpoint
(`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`),
which Web Crypto *can* import with `importKey('jwk', ...)`; match the token's
`kid` header to the right key; then
`crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)` over the
`header.payload` bytes. Cache the keys until their `max-age`.
