// EAN-13 barcode generation, validation and bar encoding. Pure and dependency-free so it
// is unit-testable and usable from both apps (and, if ever needed, the Worker).
//
// In-house codes use GS1 prefixes 20–29, which are reserved for "restricted distribution"
// — i.e. codes a shop mints for its own loose/repacked goods. They are intentionally NOT
// globally unique and must never be printed on something sold through another retailer.

/** GS1 restricted-distribution prefix used for shop-generated codes. */
export const IN_HOUSE_PREFIX = '20';

/**
 * EAN-13 check digit for the first 12 digits: weight alternating 1/3 from the left, then
 * the amount needed to reach the next multiple of ten.
 */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('ean13CheckDigit expects exactly 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  const c = (code || '').trim();
  if (!/^\d{13}$/.test(c)) return false;
  return ean13CheckDigit(c.slice(0, 12)) === Number(c[12]);
}

/**
 * Mint an in-house EAN-13 from a sequence number (1, 2, 3 …). The sequence is zero-padded
 * into the 10 digits between the prefix and the check digit, so a shop can mint ~10 billion
 * codes before wrapping.
 */
export function generateEan13(sequence: number, prefix: string = IN_HOUSE_PREFIX): string {
  if (!/^\d{2}$/.test(prefix)) throw new Error('prefix must be exactly 2 digits');
  const seq = Math.floor(Math.abs(sequence)) % 10 ** 10;
  const first12 = prefix + String(seq).padStart(10, '0');
  return first12 + String(ean13CheckDigit(first12));
}

/**
 * Derive a stable in-house barcode for a product id. Uses a small FNV-1a hash so the same
 * product always mints the same code, without needing a shared counter in Firestore.
 * Collisions are possible in principle (10^10 space) — the admin UI checks for duplicates
 * against the existing catalogue before saving.
 */
export function barcodeForProduct(productId: string, prefix: string = IN_HOUSE_PREFIX): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < productId.length; i++) {
    hash ^= productId.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return generateEan13(hash, prefix);
}

// --------------------------------------------------------------------- bar encoding
// Standard EAN-13 element tables. Each digit is seven modules wide; which of the three
// alphabets a left-hand digit uses is chosen by the leading (13th) digit's parity pattern.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/**
 * Expand an EAN-13 into its module string: '1' = bar, '0' = space, 95 modules wide
 * including the guard patterns. Render it by drawing one thin rectangle per '1'.
 */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error(`not a valid EAN-13: ${code}`);
  const digits = code.split('').map(Number);
  const parity = PARITY[digits[0]];
  let out = '101'; // start guard
  for (let i = 1; i <= 6; i++) {
    out += parity[i - 1] === 'L' ? L[digits[i]] : G[digits[i]];
  }
  out += '01010'; // centre guard
  for (let i = 7; i <= 12; i++) {
    out += R[digits[i]];
  }
  return out + '101'; // end guard
}
