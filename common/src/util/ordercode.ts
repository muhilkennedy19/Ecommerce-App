/**
 * Human-friendly public order code, e.g. `mkenK7P3Q2`. Shown to buyers and sellers as the
 * "Order ID" (the Firestore doc id stays the internal key). Random rather than sequential so it
 * leaks no volume information; the alphabet drops visually ambiguous characters (0/O/1/I/L) so a
 * code read aloud or typed into the orders search box is unambiguous.
 *
 * Six characters over a 30-symbol alphabet is ~7.3×10⁸ combinations — collision risk is
 * negligible at this scale, so (like the invoice/referral codes) it is not transactionally
 * de-duplicated.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PREFIX = 'mken';

export function makeOrderCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return CODE_PREFIX + suffix;
}

/** The code to display for an order: its `orderCode`, or a short slice of the doc id for orders
 *  created before codes existed. */
export function orderDisplayCode(o: { orderCode?: string | null; id: string }): string {
  return o.orderCode ?? o.id.slice(0, 8);
}

/**
 * Whether an order matches a free-text order-code search. Case-insensitive and lenient: it
 * ignores spaces and a leading `#`, and matches against both the `orderCode` and the doc id, so
 * "K7P3", "mkenk7p3q2", and "#MKEN…" all find the same order. Empty query matches everything.
 */
export function orderMatchesCode(o: { orderCode?: string | null; id: string }, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '');
  if (!q) return true;
  const code = (o.orderCode ?? '').toLowerCase();
  return code.includes(q) || o.id.toLowerCase().includes(q);
}
