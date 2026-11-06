import { describe, expect, it } from 'vitest';

import {
  barcodeForProduct,
  ean13CheckDigit,
  ean13Modules,
  generateEan13,
  IN_HOUSE_PREFIX,
  isValidEan13,
} from '../src/util/barcode';
import { effectiveStock, isLowStock, isOutOfStock, lowStockReport } from '../src/util/stock';
import type { Product } from '../src/types';

describe('ean13CheckDigit', () => {
  it('matches known GS1 examples', () => {
    // 4006381333931 is the GS1 specification's worked example.
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('978030640615')).toBe(7);
  });

  it('rejects anything that is not 12 digits', () => {
    expect(() => ean13CheckDigit('123')).toThrow();
    expect(() => ean13CheckDigit('12345678901a')).toThrow();
  });
});

describe('isValidEan13', () => {
  it('accepts a well-formed code', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339311')).toBe(false);
    expect(isValidEan13('40063813339X1')).toBe(false);
  });
});

describe('generateEan13', () => {
  it('always produces a self-consistent code', () => {
    for (const n of [0, 1, 42, 999999, 1234567890]) {
      expect(isValidEan13(generateEan13(n))).toBe(true);
    }
  });

  it('uses the restricted-distribution prefix by default', () => {
    expect(generateEan13(1).startsWith(IN_HOUSE_PREFIX)).toBe(true);
  });

  it('rejects a malformed prefix', () => {
    expect(() => generateEan13(1, '2')).toThrow();
  });
});

describe('barcodeForProduct', () => {
  it('is stable for the same product id', () => {
    expect(barcodeForProduct('prod_abc')).toBe(barcodeForProduct('prod_abc'));
  });

  it('differs between products', () => {
    expect(barcodeForProduct('prod_abc')).not.toBe(barcodeForProduct('prod_xyz'));
  });

  it('always yields a valid EAN-13', () => {
    expect(isValidEan13(barcodeForProduct('anything-at-all'))).toBe(true);
  });
});

describe('ean13Modules', () => {
  it('is 95 modules wide with the standard guards', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(m.startsWith('101')).toBe(true);
    expect(m.endsWith('101')).toBe(true);
    expect(m.slice(45, 50)).toBe('01010');
  });

  it('refuses an invalid code rather than drawing nonsense', () => {
    expect(() => ean13Modules('4006381333932')).toThrow();
  });
});

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    shopId: 's1',
    categoryId: 'c1',
    name: 'Test',
    description: '',
    price: 100,
    active: true,
    perishable: false,
    trackStock: true,
    stock: 10,
    onDemand: false,
    ...over,
  } as Product;
}

describe('effectiveStock', () => {
  it('uses the manual count without barcodes', () => {
    expect(effectiveStock(product({ stock: 7 }))).toBe(7);
  });

  it('sums barcode quantities when present', () => {
    expect(
      effectiveStock(product({ stock: 7, barcodes: [{ code: 'a', qty: 2 }, { code: 'b', qty: 3 }] })),
    ).toBe(5);
  });
});

describe('isOutOfStock / isLowStock', () => {
  it('never flags an untracked product', () => {
    expect(isOutOfStock(product({ trackStock: false, stock: 0 }))).toBe(false);
    expect(isLowStock(product({ trackStock: false, stock: 0, reorderLevel: 5 }))).toBe(false);
  });

  it('flags zero stock as out', () => {
    expect(isOutOfStock(product({ stock: 0 }))).toBe(true);
  });

  it('needs a reorder level to be low', () => {
    expect(isLowStock(product({ stock: 2 }))).toBe(false);
    expect(isLowStock(product({ stock: 2, reorderLevel: 5 }))).toBe(true);
  });

  it('treats at-the-level as low', () => {
    expect(isLowStock(product({ stock: 5, reorderLevel: 5 }))).toBe(true);
    expect(isLowStock(product({ stock: 6, reorderLevel: 5 }))).toBe(false);
  });

  it('reports out, not low, at zero', () => {
    const p = product({ stock: 0, reorderLevel: 5 });
    expect(isOutOfStock(p)).toBe(true);
    expect(isLowStock(p)).toBe(false);
  });
});

describe('lowStockReport', () => {
  it('splits products into out and low without double-counting', () => {
    const r = lowStockReport([
      product({ id: 'a', stock: 0, reorderLevel: 5 }),
      product({ id: 'b', stock: 3, reorderLevel: 5 }),
      product({ id: 'c', stock: 50, reorderLevel: 5 }),
      product({ id: 'd', trackStock: false, stock: 0, reorderLevel: 5 }),
    ]);
    expect(r.out.map((p) => p.id)).toEqual(['a']);
    expect(r.low.map((p) => p.id)).toEqual(['b']);
  });
});
