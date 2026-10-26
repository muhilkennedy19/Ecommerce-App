// Build a UPI deep link (`upi://pay?...`) for the India UPI apps (GPay/PhonePe/Paytm/etc.).
// NOTE: the payment result from this flow is NOT cryptographically verifiable — treat it as
// "claimed" and reconcile against the receiver's UPI/bank statement.
import type { PaymentMode } from '../types';
//
// Encoding matters here. `URLSearchParams` serialises spaces as `+`, which several UPI
// apps fail to decode in `pn`/`tn`; the payee then looks malformed and the app falls back
// to an unverified-payee path that surfaces as "limit exceeded" / "unable to send" even
// for small amounts. We therefore build the query manually with percent-encoding, pin the
// amount to exactly two decimals (float maths can otherwise yield 10.000000000000002,
// which some apps reject), and strip characters the spec does not allow in free text.
//
// We deliberately DO NOT send `tr` (transaction reference). In the UPI spec `tr` is the
// MERCHANT transaction-reference field, so Google Pay (and others) route any intent that
// carries it through the person-to-merchant (P2M) path — which requires the payee to be a
// registered merchant VPA. For a personal payee VPA that path is refused and GPay shows a
// misleading "receiver limit reached" error, even though a manual P2P transfer to the same
// VPA succeeds. Omitting `tr` keeps this a plain P2P intent, matching the manual flow. The
// order number still rides along in the human-readable `tn` note for reconciliation.

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

  return `upi://pay?${parts.join('&')}`;
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cod: 'Cash on delivery',
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
};

export const PAYMENT_STATUS_LABELS: Record<'pending' | 'claimed' | 'verified', string> = {
  pending: 'Payment pending',
  claimed: 'Paid (unverified)',
  verified: 'Payment verified',
};
