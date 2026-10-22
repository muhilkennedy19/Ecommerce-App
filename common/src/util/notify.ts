// Fire an event at the (optional) external notify function, which fans out push via FCM.
// Graceful no-op when the URL or auth token is absent, so the apps work without push.
export type NotifyEvent =
  | { event: 'new-order'; shopId: string; orderId: string }
  | { event: 'order-status'; customerId: string; status: string; orderId?: string }
  | { event: 'back-in-stock'; shopId: string; productId: string; productName?: string };

export async function sendNotify(
  url: string | undefined | null,
  idToken: string | null,
  payload: NotifyEvent,
): Promise<void> {
  if (!url || !idToken) return; // push not configured → no-op
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort; never block the user flow on a push failure
  }
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Display name for the From header, e.g. the shop name (improves deliverability). */
  fromName?: string;
}

/** Ask the notify function to send an email via Gmail. Returns false (no-op) if unconfigured. */
export async function sendEmail(
  url: string | undefined | null,
  idToken: string | null,
  payload: EmailPayload,
): Promise<boolean> {
  if (!url || !idToken) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ event: 'email', ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
