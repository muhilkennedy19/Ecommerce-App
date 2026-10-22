// Build a UPI deep link (`upi://pay?...`) for the India UPI apps (GPay/PhonePe/Paytm/etc.).
// NOTE: the payment result from this flow is NOT cryptographically verifiable — treat it as
// "claimed" and reconcile against the receiver's UPI/bank statement.
export function buildUpiUrl(p: {
  vpa: string;
  payeeName?: string | null;
  amount: number;
  note?: string;
  ref?: string;
}): string {
  const params = new URLSearchParams({ pa: p.vpa, cu: 'INR', am: String(p.amount) });
  if (p.payeeName) params.set('pn', p.payeeName);
  if (p.note) params.set('tn', p.note);
  if (p.ref) params.set('tr', p.ref);
  return `upi://pay?${params.toString()}`;
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
