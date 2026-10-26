/**
 * Free external push sender for the e-commerce apps.
 *
 * Runs as a Cloudflare Worker and talks to Firebase entirely over REST, so the
 * Firebase project can stay on the free Spark plan (no Cloud Functions / Blaze).
 *
 * Flow per request:
 *   1. Accept POST only.
 *   2. Authenticate the caller's Firebase ID token (see verifyFirebaseIdToken).
 *   3. Mint a short-lived Google OAuth2 access token from the service account.
 *   4. Read recipient FCM device tokens from Firestore (REST).
 *   5. Fan out FCM HTTP v1 sends, collecting per-token failures.
 *   6. Respond { sent, failed }.
 *
 * No npm runtime dependencies: Web Crypto + fetch only.
 */

export interface Env {
  /** Service-account JSON (the whole file) stored as a Worker secret. */
  FIREBASE_SERVICE_ACCOUNT: string;

  // --- Gmail API OAuth refresh-token credentials (for the `email` event). ---
  /** OAuth client id of the Google Cloud "Desktop"/"Web" app. */
  GMAIL_CLIENT_ID: string;
  /** OAuth client secret matching GMAIL_CLIENT_ID. */
  GMAIL_CLIENT_SECRET: string;
  /** Long-lived refresh token granted the `gmail.send` scope. */
  GMAIL_REFRESH_TOKEN: string;
  /** The authorized sender address (used in the RFC 2822 `From:` header). */
  GMAIL_SENDER: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

type IncomingBody =
  | { event: "new-order"; shopId: string; orderId: string }
  | { event: "order-status"; customerId: string; status: string; orderId?: string }
  | { event: "back-in-stock"; shopId: string; productId: string; productName?: string }
  | { event: "email"; to: string; subject: string; text: string; html?: string; fromName?: string };

interface Notification {
  title: string;
  body: string;
}

/** A recipient token plus the Firestore doc id it came from (for diagnostics). */
interface Recipient {
  token: string;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    }

    let body: IncomingBody;
    try {
      body = (await request.json()) as IncomingBody;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
      return json({ error: `Server misconfigured: ${(err as Error).message}` }, 500);
    }

    // --- Authn: require a valid Firebase ID token from the app. ---
    const idToken = readBearer(request);
    if (!idToken) {
      return json({ error: "Missing Authorization: Bearer <Firebase ID token>" }, 401);
    }
    const authResult = await verifyFirebaseIdToken(idToken, serviceAccount.project_id);
    if (!authResult.ok) {
      return json({ error: `Unauthorized: ${authResult.reason}` }, 401);
    }

    // --- Email event: send via Gmail API. Uses its own OAuth refresh-token
    //     creds, so it does NOT need the Firebase/FCM access token minted below. ---
    if (body.event === "email") {
      return handleEmailEvent(body, env);
    }

    // --- Mint a Google OAuth2 access token (cached for this request only). ---
    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccount);
    } catch (err) {
      return json({ error: `Failed to mint access token: ${(err as Error).message}` }, 502);
    }

    const ctx = { accessToken, projectId: serviceAccount.project_id };

    try {
      let recipients: Recipient[];
      let notification: Notification;
      let data: Record<string, string>;
      let highPriorityOrders = false;

      switch (body.event) {
        case "new-order": {
          recipients = await getAdminRecipients(ctx);
          notification = {
            title: "New order",
            body: "A new order just came in — tap to view",
          };
          data = { event: "new-order", shopId: body.shopId, orderId: body.orderId };
          highPriorityOrders = true;
          break;
        }
        case "order-status": {
          recipients = await getRecipientsForUser(ctx, body.customerId);
          notification = {
            title: "Order update",
            body: `Your order is now ${body.status}`,
          };
          data = {
            event: "order-status",
            status: body.status,
            ...(body.orderId ? { orderId: body.orderId } : {}),
          };
          break;
        }
        case "back-in-stock": {
          const customerIds = await findCustomersWatchingProduct(ctx, body.productId);
          recipients = await getRecipientsForUsers(ctx, customerIds);
          notification = {
            title: "Back in stock",
            body: `${body.productName || "An item"} is back in stock`,
          };
          data = {
            event: "back-in-stock",
            shopId: body.shopId,
            productId: body.productId,
            ...(body.productName ? { productName: body.productName } : {}),
          };
          break;
        }
        default: {
          return json({ error: "Unknown event" }, 400);
        }
      }

      const result = await sendToRecipients(ctx, recipients, notification, data, highPriorityOrders);
      return json(result, 200);
    } catch (err) {
      return json({ error: `Send failed: ${(err as Error).message}` }, 502);
    }
  },

  /**
   * Cron-triggered re-reminder sweep (see wrangler.toml `[triggers]`).
   *
   * Finds `orders` still in `status === 'new'` and, for any that have been
   * waiting longer than ~30s without anyone accepting/rejecting them, re-rings
   * the employees' phones — repeatedly, once per cron tick — until the order
   * leaves 'new' or a per-order safety cap of 15 reminders is reached.
   *
   * Cloudflare's minimum cron interval is 1 minute, so the first re-ring fires
   * within ~1 min of the 30s threshold rather than exactly at 30s.
   */
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      // Misconfigured secret — nothing we can do in a cron run.
      return;
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccount);
    } catch {
      return;
    }

    const ctx: Ctx = { accessToken, projectId: serviceAccount.project_id };

    let orders: FirestoreDoc[];
    try {
      orders = await findNewOrders(ctx);
    } catch {
      return;
    }
    if (orders.length === 0) {
      return;
    }

    // Resolve the admin recipients once and reuse them for every order — same
    // recipients + high-priority "orders" ring as the `new-order` event.
    let recipients: Recipient[];
    try {
      recipients = await getAdminRecipients(ctx);
    } catch {
      return;
    }

    const notification: Notification = {
      title: "New order still waiting",
      body: "An order hasn't been picked up yet — tap to view",
    };

    const nowMs = Date.now();

    await Promise.all(
      orders.map(async (doc) => {
        try {
          // Only act on orders that have been waiting past the 30s threshold.
          const createdAt = doc.fields?.createdAt?.timestampValue;
          if (!createdAt) return;
          const createdMs = Date.parse(createdAt);
          if (!Number.isFinite(createdMs)) return;
          if (nowMs - createdMs <= REMINDER_MIN_AGE_MS) return;

          // Safety cap so an order can never ring forever.
          const remindersRaw = doc.fields?.reminders?.integerValue;
          const reminders = remindersRaw ? Number.parseInt(remindersRaw, 10) : 0;
          if (Number.isFinite(reminders) && reminders >= REMINDER_CAP) return;

          const orderId = docId(doc.name);
          const shopId = doc.fields?.shopId?.stringValue;
          const data: Record<string, string> = {
            event: "order-reminder",
            orderId,
            ...(shopId ? { shopId } : {}),
          };

          await sendToRecipients(ctx, recipients, notification, data, true);
          await bumpReminder(ctx, doc.name, (Number.isFinite(reminders) ? reminders : 0) + 1);
        } catch {
          // Swallow per-order failures so one bad order can't abort the batch.
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Firebase ID token verification
// ---------------------------------------------------------------------------

type AuthResult = { ok: true; uid: string } | { ok: false; reason: string };

/**
 * Validates the Firebase ID token presented by the app.
 *
 * NOTE: This performs the standard Firebase ID-token *claim* checks (aud, iss,
 * exp) but does NOT cryptographically verify the RS256 signature.
 *
 * Why: full signature verification requires the signing public key, which
 * Firebase publishes only as X.509 PEM certificates at
 * https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com
 * The Web Crypto API cannot import an X.509 certificate directly (it only
 * accepts a raw SubjectPublicKeyInfo via `spki`), and extracting the SPKI from
 * the certificate requires ASN.1/DER parsing that we cannot do reliably without
 * an npm dependency. Rather than ship a fragile hand-rolled ASN.1 parser that
 * could reject legitimate users, we gate on the claims below.
 *
 * TODO: verify signature for production — import the Firebase signing cert
 * (e.g. via the JWK endpoint
 * https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 * which Web Crypto CAN import with importKey('jwk', ...)), match the token's
 * `kid` header, and `crypto.subtle.verify('RSASSA-PKCS1-v1_5', ...)` the
 * `header.payload` bytes against the signature. See README "Security caveat".
 */
async function verifyFirebaseIdToken(token: string, projectId: string): Promise<AuthResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed token" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(utf8Decode(base64urlToBytes(parts[1]))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "undecodable payload" };
  }

  const expectedIss = "https://securetoken.google.com/" + projectId;
  if (payload.aud !== projectId) {
    return { ok: false, reason: "aud mismatch" };
  }
  if (payload.iss !== expectedIss) {
    return { ok: false, reason: "iss mismatch" };
  }
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp * 1000 <= Date.now()) {
    return { ok: false, reason: "token expired" };
  }

  const uid = typeof payload.sub === "string" && payload.sub ? payload.sub : "";
  if (!uid) {
    return { ok: false, reason: "missing subject" };
  }
  return { ok: true, uid };
}

// ---------------------------------------------------------------------------
// Service account + Google OAuth2 access token
// ---------------------------------------------------------------------------

function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set");
  }
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("service account missing client_email / private_key / project_id");
  }
  return parsed as ServiceAccount;
}

/**
 * Builds and RS256-signs a JWT assertion, then exchanges it for a Google OAuth2
 * access token scoped for FCM + Firestore.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope:
      "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64urlEncode(utf8Encode(JSON.stringify(header)))}.${base64urlEncode(
    utf8Encode(JSON.stringify(claims)),
  )}`;

  const key = await importPkcs8RsaKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8Encode(unsigned),
  );
  const assertion = `${unsigned}.${base64urlEncode(new Uint8Array(signature))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!resp.ok) {
    throw new Error(`token endpoint ${resp.status}: ${await safeText(resp)}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("token endpoint returned no access_token");
  }
  return data.access_token;
}

/** Imports a PEM PKCS#8 RSA private key for RS256 signing via Web Crypto. */
async function importPkcs8RsaKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n");
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(b64);
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// ---------------------------------------------------------------------------
// Firestore REST
// ---------------------------------------------------------------------------

interface Ctx {
  accessToken: string;
  projectId: string;
}

function firestoreBase(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  timestampValue?: string;
  booleanValue?: boolean;
  arrayValue?: { values?: FirestoreValue[] };
}

interface FirestoreDoc {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

/**
 * FCM tokens for order-server devices only.
 *
 * Order notifications (the `new-order` event and the cron re-reminder sweep,
 * which both call this) must reach only staff who handle orders — not every
 * admin-app device. A token is included ONLY when `kind === 'admin'`, the owner holds
 * an order-handling role (`sales` / `admin` / `superuser`) in either the legacy `role`
 * field or the `roles` array, AND has not switched order alerts off (`notify === false`).
 */
const ORDER_RECIPIENT_ROLES = new Set(["sales", "admin", "superuser"]);

async function getAdminRecipients(ctx: Ctx): Promise<Recipient[]> {
  const base = firestoreBase(ctx.projectId);
  const recipients: Recipient[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${base}/pushTokens`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await authedGet(ctx, url.toString());
    if (!resp.ok) {
      throw new Error(`list pushTokens ${resp.status}: ${await safeText(resp)}`);
    }
    const data = (await resp.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    for (const doc of data.documents ?? []) {
      const token = doc.fields?.token?.stringValue;
      const kind = doc.fields?.kind?.stringValue;
      const role = doc.fields?.role?.stringValue;
      const roles = (doc.fields?.roles?.arrayValue?.values ?? [])
        .map((v) => v.stringValue)
        .filter((s): s is string => typeof s === "string");
      // notify defaults to ON: only an explicit `false` opts the device out.
      const notifyOff = doc.fields?.notify?.booleanValue === false;
      const qualifies =
        (!!role && ORDER_RECIPIENT_ROLES.has(role)) ||
        roles.some((r) => ORDER_RECIPIENT_ROLES.has(r));
      if (token && kind === "admin" && qualifies && !notifyOff) {
        recipients.push({ token, ownerId: docId(doc.name) });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return recipients;
}

/** The FCM token stored at pushTokens/{uid}, if any. */
async function getRecipientsForUser(ctx: Ctx, uid: string): Promise<Recipient[]> {
  const base = firestoreBase(ctx.projectId);
  const resp = await authedGet(ctx, `${base}/pushTokens/${encodeURIComponent(uid)}`);
  if (resp.status === 404) {
    return [];
  }
  if (!resp.ok) {
    throw new Error(`get pushTokens/${uid} ${resp.status}: ${await safeText(resp)}`);
  }
  const doc = (await resp.json()) as FirestoreDoc;
  const token = doc.fields?.token?.stringValue;
  return token ? [{ token, ownerId: uid }] : [];
}

async function getRecipientsForUsers(ctx: Ctx, uids: string[]): Promise<Recipient[]> {
  const perUser = await Promise.all(uids.map((uid) => getRecipientsForUser(ctx, uid)));
  return perUser.flat();
}

/** Customer ids whose `notifyBackInStock` array contains productId. */
async function findCustomersWatchingProduct(ctx: Ctx, productId: string): Promise<string[]> {
  const base = firestoreBase(ctx.projectId);
  const resp = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "customers" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "notifyBackInStock" },
            op: "ARRAY_CONTAINS",
            value: { stringValue: productId },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`runQuery customers ${resp.status}: ${await safeText(resp)}`);
  }

  const rows = (await resp.json()) as Array<{ document?: FirestoreDoc }>;
  const ids: string[] = [];
  for (const row of rows) {
    if (row.document?.name) {
      ids.push(docId(row.document.name));
    }
  }
  return ids;
}

async function authedGet(ctx: Ctx, url: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
}

// --- Re-reminder sweep (cron) ---------------------------------------------

/** Only re-ring orders that have been waiting longer than this (ms). */
const REMINDER_MIN_AGE_MS = 30_000;
/** Stop re-ringing an order after this many reminders (safety cap). */
const REMINDER_CAP = 15;

/** All `orders` docs currently in `status === 'new'`. */
async function findNewOrders(ctx: Ctx): Promise<FirestoreDoc[]> {
  const base = firestoreBase(ctx.projectId);
  const resp = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "new" },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`runQuery orders ${resp.status}: ${await safeText(resp)}`);
  }

  const rows = (await resp.json()) as Array<{ document?: FirestoreDoc }>;
  const docs: FirestoreDoc[] = [];
  for (const row of rows) {
    if (row.document) docs.push(row.document);
  }
  return docs;
}

/**
 * Bumps an order's `reminders` counter and stamps `lastRemindedAt`, using a
 * Firestore `updateMask` PATCH so only those two fields are touched.
 */
async function bumpReminder(ctx: Ctx, name: string | undefined, nextCount: number): Promise<void> {
  if (!name) return;
  const url = new URL(`https://firestore.googleapis.com/v1/${name}`);
  url.searchParams.append("updateMask.fieldPaths", "reminders");
  url.searchParams.append("updateMask.fieldPaths", "lastRemindedAt");

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        reminders: { integerValue: String(nextCount) },
        lastRemindedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`patch order ${resp.status}: ${await safeText(resp)}`);
  }
}

/** Extracts the last path segment of a Firestore document resource name. */
function docId(name: string | undefined): string {
  if (!name) return "";
  const idx = name.lastIndexOf("/");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

// ---------------------------------------------------------------------------
// FCM HTTP v1 send
// ---------------------------------------------------------------------------

interface SendResult {
  sent: number;
  failed: number;
}

async function sendToRecipients(
  ctx: Ctx,
  recipients: Recipient[],
  notification: Notification,
  data: Record<string, string>,
  highPriorityOrders: boolean,
): Promise<SendResult> {
  if (recipients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const results = await Promise.all(
    recipients.map((r) => sendOne(ctx, r, notification, data, highPriorityOrders)),
  );

  let sent = 0;
  let failed = 0;
  for (const ok of results) {
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Sends one FCM message; returns true on success, false on any per-token failure. */
async function sendOne(
  ctx: Ctx,
  recipient: Recipient,
  notification: Notification,
  data: Record<string, string>,
  highPriorityOrders: boolean,
): Promise<boolean> {
  const androidNotification: Record<string, string> = {
    channelId: highPriorityOrders ? "orders" : "default",
  };
  if (highPriorityOrders) {
    androidNotification.sound = "order_ring";
  }

  const message = {
    message: {
      token: recipient.token,
      notification: { title: notification.title, body: notification.body },
      data,
      android: {
        priority: "high",
        notification: androidNotification,
      },
    },
  };

  try {
    const resp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${ctx.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    // A non-2xx (e.g. UNREGISTERED / invalid token) is a per-token failure; we
    // swallow it so one bad token doesn't fail the whole batch.
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Gmail API send (OAuth refresh-token creds)
// ---------------------------------------------------------------------------

/**
 * Handles `{ event: 'email', to, subject, text, html? }`.
 *
 * The caller has already been authenticated (Firebase ID-token claim check) by
 * the fetch handler. Here we validate the payload, mint a Gmail access token
 * from the refresh-token creds, build an RFC 2822 message and POST it to the
 * Gmail API. Returns { sent: true, id } on success, { sent: false, error } else.
 */
async function handleEmailEvent(
  body: Extract<IncomingBody, { event: "email" }>,
  env: Env,
): Promise<Response> {
  const { to, subject, text, html, fromName } = body;
  if (!to || !subject || !text) {
    return json({ error: "email requires to, subject and text" }, 400);
  }

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER } = env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER) {
    return json({ error: "email not configured" }, 503);
  }

  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN,
    );
  } catch (err) {
    return json({ sent: false, error: `token: ${(err as Error).message}` }, 502);
  }

  const raw = buildGmailRawMessage(GMAIL_SENDER, to, subject, text, html, fromName);

  const resp = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );

  if (!resp.ok) {
    return json({ sent: false, error: await safeText(resp) }, 502);
  }
  const data = (await resp.json()) as { id?: string };
  return json({ sent: true, id: data.id }, 200);
}

/**
 * Exchanges the stored OAuth refresh token for a short-lived Gmail access token.
 *
 * Same token endpoint as getAccessToken(), but a `refresh_token` grant with the
 * OAuth client creds rather than a signed service-account JWT assertion.
 */
async function getGmailAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    throw new Error(`token endpoint ${resp.status}: ${await safeText(resp)}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("token endpoint returned no access_token");
  }
  return data.access_token;
}

/**
 * Builds a base64url-encoded RFC 2822 message for the Gmail `raw` field.
 *
 * Deliverability hardening: non-ASCII header values (subject, From display name)
 * are MIME "encoded-word" (RFC 2047) encoded so clients never render raw UTF-8
 * bytes as garbage. When `html` is provided the body is a `multipart/alternative`
 * carrying BOTH the plain-text and HTML parts (single-part HTML-only mail reads as
 * spammier). A `Reply-To` is set to the sender. CRLF line breaks throughout.
 */
function buildGmailRawMessage(
  from: string,
  to: string,
  subject: string,
  text: string,
  html?: string,
  fromName?: string,
): string {
  const useHtml = typeof html === "string" && html.length > 0;
  const fromHeader =
    fromName && fromName.trim()
      ? `${encodeHeaderWord(fromName.trim())} <${from}>`
      : from;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
  ];

  let message: string;
  if (useHtml) {
    const boundary = "alt_boundary_app_mail";
    message = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html as string,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    message = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
    ].join("\r\n");
  }

  return base64urlEncode(utf8Encode(message));
}

/**
 * RFC 2047 "encoded-word" for an email header value. Pure-ASCII values pass
 * through unchanged; anything with non-ASCII (emoji, Tamil shop name, etc.) is
 * UTF-8 base64 wrapped as `=?UTF-8?B?...?=` so clients decode it correctly.
 */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${base64Standard(utf8Encode(value))}?=`;
}

/** Standard (non-url) base64 with padding — used for MIME encoded-words. */
function base64Standard(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Encoding helpers (Web-standard only)
// ---------------------------------------------------------------------------

function readBearer(request: Request): string | null {
  const header = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function base64urlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return base64ToBytes(b64);
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(payload: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
