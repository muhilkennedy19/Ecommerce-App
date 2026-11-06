// Stock-level helpers. Pure functions over a Product so the admin dashboard, inventory
// screen and product list all agree on what "running low" means.
import type { Product } from '../types';

/** Effective on-hand count: barcoded items derive stock from the sum of their counts. */
export function effectiveStock(product: Pick<Product, 'stock' | 'barcodes'>): number {
  const codes = product.barcodes;
  if (codes && codes.length > 0) {
    return codes.reduce((sum, b) => sum + (Number.isFinite(b.qty) ? b.qty : 0), 0);
  }
  return Number(product.stock ?? 0);
}

export function isOutOfStock(
  product: Pick<Product, 'trackStock' | 'stock' | 'barcodes'>,
): boolean {
  if (!product.trackStock) return false;
  return effectiveStock(product) <= 0;
}

/**
 * Running low = tracked, still in stock, and at or below the product's reorder level.
 * Items already at zero are "out", not "low", so the two badges never both fire.
 */
export function isLowStock(
  product: Pick<Product, 'trackStock' | 'stock' | 'barcodes' | 'reorderLevel'>,
): boolean {
  if (!product.trackStock) return false;
  const level = product.reorderLevel;
  if (level == null || !Number.isFinite(level) || level <= 0) return false;
  const have = effectiveStock(product);
  return have > 0 && have <= level;
}

/** Everything needing attention, newest concern first: out of stock before merely low. */
export function lowStockReport<T extends Pick<Product, 'trackStock' | 'stock' | 'barcodes' | 'reorderLevel'>>(
  products: T[],
): { out: T[]; low: T[] } {
  const out: T[] = [];
  const low: T[] = [];
  for (const p of products) {
    if (isOutOfStock(p)) out.push(p);
    else if (isLowStock(p)) low.push(p);
  }
  return { out, low };
}
