# Hardening the notify Worker's token verification

**Status:** accepted risk, not yet mitigated.
**Applies to:** [`functions/notify/src/index.ts`](../functions/notify/src/index.ts)
**Do this before:** the apps are public on the Play Store and the Worker URL is reachable by
anyone who decompiles an APK.

---

## The problem

Every request to the Worker carries a Firebase ID token in an `Authorization: Bearer …`
header. The Worker currently performs a **claim check only**:

- `aud` matches the Firebase project id
- `iss` is `https://securetoken.google.com/<project-id>`
- `exp` is in the future

It does **not** verify the RS256 signature. The reason is practical rather than deliberate:
Google publishes the token-signing keys as X.509 certificates, and `crypto.subtle.importKey`
cannot import an X.509 certificate without an ASN.1/DER parser, which the Worker avoided
pulling in to stay dependency-free.

### What an attacker can do today

Anyone who knows the Worker URL can mint an unsigned JWT with the three correct claims and
make the Worker:

- send arbitrary `broadcast` push notifications to **every buyer device**
- send `order-status` pushes to any customer id they can guess
- ring every admin phone with fake `new-order` alerts
- send email through the shop's Gmail account via the `email` event

### What they cannot do

The Worker never echoes Firestore data back to the caller, so this is **not** a data-exfiltration
hole. The blast radius is spam, reputational damage, and burning the Gmail send quota — not
customer data. That is why it was accepted for the private beta.

**This stops being acceptable the moment the apps are public**, because the Worker URL ships
inside the APK (`extra.notifyUrl`) and is trivially recoverable with `apktool`.

---

## The fix: verify the signature against Google's JWKS

Google publishes the same keys in **JWK** format, which Web Crypto *can* import directly:

```
https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
```

### Implementation sketch

```ts
interface Jwk { kid: string; n: string; e: string; kty: string; alg: string }

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Cache keys in module scope; the Worker isolate is reused across requests.
let jwkCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

async function getSigningKey(kid: string): Promise<CryptoKey | null> {
  if (!jwkCache || Date.now() > jwkCache.expiresAt) {
    const res = await fetch(JWKS_URL);
    const body = (await res.json()) as { keys: Jwk[] };
    // Respect Cache-Control so keys are refreshed when Google rotates them (~daily).
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys) {
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      );
    }
    jwkCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  }
  return jwkCache.keys.get(kid) ?? null;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifyIdToken(token: string, projectId: string): Promise<{ uid: string } | null> {
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
  if (header.alg !== 'RS256' || !header.kid) return null;   // reject alg:none outright

  const key = await getSigningKey(header.kid);
  if (!key) return null;

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return null;

  // Only trust the claims AFTER the signature checks out.
  const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  const now = Math.floor(Date.now() / 1000);
  if (p.aud !== projectId) return null;
  if (p.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof p.exp !== 'number' || p.exp <= now) return null;
  if (typeof p.iat !== 'number' || p.iat > now + 60) return null;  // allow 60s clock skew
  if (!p.sub) return null;

  return { uid: p.sub };
}
```

### Order of operations matters

Verify the signature **before** reading any claim. The current code reads claims first; if
that ordering is kept, a malformed token can still steer logic before it is rejected.

---

## Checklist

- [ ] Add `verifyIdToken` and replace the claim-only check at the Worker's entry point.
- [ ] Reject `alg: 'none'` and any algorithm other than `RS256` explicitly.
- [ ] Cache JWKS in module scope, honouring the `Cache-Control: max-age` header.
- [ ] Fail **closed**: if the JWKS fetch fails, reject the request rather than falling back
      to the claim check. A brief outage is better than an open relay.
- [ ] Return `401` with no body detail — do not leak which check failed.
- [ ] Add per-uid rate limiting on `broadcast` and `email` (a valid token should still not be
      able to spam every device). Cloudflare Workers KV or Durable Objects both suffice.
- [ ] Restrict `broadcast` to callers holding an admin role: verify `uid`, then read
      `users/{uid}` via the Firestore REST call the Worker already makes.
- [ ] Test with: a valid token, an expired token, a token signed by the wrong key, an
      `alg: none` token, and a token for a different Firebase project.

## Verifying the fix

```bash
# Should be rejected (unsigned, correct claims):
HEADER=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr -d '=' | tr '/+' '_-')
PAYLOAD=$(printf '{"aud":"ecommerce-rajendran","iss":"https://securetoken.google.com/ecommerce-rajendran","exp":99999999999,"sub":"fake"}' | base64 | tr -d '=' | tr '/+' '_-')
curl -i -X POST "$NOTIFY_URL" \
  -H "Authorization: Bearer ${HEADER}.${PAYLOAD}." \
  -H 'Content-Type: application/json' \
  -d '{"event":"broadcast","shopId":"main","title":"test","body":"test"}'
# Expect: HTTP/1.1 401
```

Run the same request with a real ID token (grab one from the admin app via `getIdToken()`)
and confirm it still returns `200`.

## Deploying

The Worker is independent of the Firebase deploy:

```bash
cd functions/notify
npx wrangler deploy
```

---

## Related accepted risks

Tracked in [`memory/push-architecture.md`](../memory/push-architecture.md); worth fixing in
the same pass since they share the "client is trusted too much" root cause:

| Risk | Where | Mitigation |
|---|---|---|
| Fast2SMS API key readable by the buyer app | `secrets/fast2sms`, `firestore.rules` | Move OTP send/verify behind the Worker so the key never leaves the server |
| OTP codes client-readable and client-written | `otps/*`, `common/src/otp` | Same — generate and verify server-side |
| Order item prices supplied by the client | `placeOrder` in `common/src/repos` | Re-price against the `products` collection server-side before accepting |
| Loyalty redemption supplied by the client | `placeOrder`, `loyaltyRedeemed` | Settle against the real balance server-side at order creation |
