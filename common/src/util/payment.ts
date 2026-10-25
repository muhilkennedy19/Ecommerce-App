// Build a UPI deep link (`upi://pay?...`) for the India UPI apps (GPay/PhonePe/Paytm/etc.).
// NOTE: the payment result from this flow is NOT cryptographically verifiable — treat it as
// "claimed" and reconcile against the receiver's UPI/bank statement.
//
// Encoding matters here. `URLSearchParams` serialises spaces as `+`, which several UPI
// apps fail to decode in `pn`/`tn`; the payee then looks malformed and the app falls back
// to an unverified-payee path that surfaces as "limit exceeded" / "unable to send" even
// for small amounts. We therefore build the query manually with percent-encoding, pin the
// amount to exactly two decimals (float maths can otherwise yield 10.000000000000002,
// which some apps reject), and strip characters the spec does not allow in free text.

/** UPI free-text fields tolerate letters, digits, spaces and a few separators only. */
function upiText(s: string, max: number): string {
  return s
    .replace(/[^A-Za-z0-9 .\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function buildUpiUrl(p: {
  vpa: string;
  payeeName?: string | null;
  amount: number;
  note?: string;
  ref?: string;
}): string {
  const parts: string[] = [
    `pa=${encodeURIComponent(p.vpa.trim())}`,
    'cu=INR',
    // Always two decimals: "10" and "10.000000000000002" are both rejected by some apps.
    `am=${Math.max(0, p.amount).toFixed(2)}`,
  ];

  const pn = p.payeeName ? upiText(p.payeeName, 50) : '';
  if (pn) parts.push(`pn=${encodeURIComponent(pn)}`);

  const tn = p.note ? upiText(p.note, 50) : '';
  if (tn) parts.push(`tn=${encodeURIComponent(tn)}`);

  // Transaction ref: alphanumeric only, else the app may silently drop the whole intent.
  const tr = p.ref ? p.ref.replace(/[^A-Za-z0-9]/g, '').slice(0, 35) : '';
  if (tr) parts.push(`tr=${tr}`);

  return `upi://pay?${parts.join('&')}`;
}

export const PAYMENT_MODE_LABELS: Record<'cod' | 'upi', string> = {
  cod: 'Cash on delivery',
  upi: 'UPI',
};

export const PAYMENT_STATUS_LABELS: Record<'pending' | 'claimed' | 'verified', string> = {
  pending: 'Payment pending',
  claimed: 'Paid (unverified)',
  verified: 'Payment verified',
};
