import { roundMoney, type ProductUnit } from '@common';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** A single line in the buyer's cart. Mirrors the shared `OrderItem` shape. */
export interface CartLine {
  productId: string;
  name: string;
  /** Unit price charged at add-to-cart time (already the discounted price if on sale). */
  price: number;
  /**
   * Amount in the product's own unit. Whole numbers for countable items; for
   * divisible units (₹/Kg, ₹/Litre) this is fractional — 0.3 means 300 g.
   */
  qty: number;
  /** Selling unit, so checkout knows whether to offer a grams/ml picker. */
  unit?: ProductUnit | null;
}

interface CartState {
  lines: CartLine[];
  /** Number of distinct products currently in the cart. */
  count: number;
  /** Sum of every line's price * qty. */
  total: number;
  /** Add one unit of a product (increments qty if already present). */
  add: (item: Omit<CartLine, 'qty'> & { qty?: number }) => void;
  /** Set the exact quantity for a product (<= 0 removes it). */
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  const value = useMemo<CartState>(() => {
    const add: CartState['add'] = (item) =>
      setLines((prev) => {
        const step = item.qty ?? 1;
        const existing = prev.find((l) => l.productId === item.productId);
        if (existing) {
          return prev.map((l) =>
            l.productId === item.productId
              ? { ...l, qty: roundQty(l.qty + step) }
              : l,
          );
        }
        return [...prev, { ...item, qty: step }];
      });

    const setQty: CartState['setQty'] = (productId, qty) =>
      setLines((prev) =>
        qty <= 0
          ? prev.filter((l) => l.productId !== productId)
          : prev.map((l) => (l.productId === productId ? { ...l, qty: roundQty(qty) } : l)),
      );

    const remove: CartState['remove'] = (productId) =>
      setLines((prev) => prev.filter((l) => l.productId !== productId));

    return {
      lines,
      count: lines.length,
      total: roundMoney(lines.reduce((sum, l) => sum + l.price * l.qty, 0)),
      add,
      setQty,
      remove,
      clear: () => setLines([]),
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Keep fractional quantities clean (0.1 + 0.2 would otherwise drift). */
function roundQty(q: number): number {
  return Math.round(q * 1000) / 1000;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
