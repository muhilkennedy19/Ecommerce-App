import { roundMoney, type ProductUnit } from '@common';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** AsyncStorage key the cart is persisted under, so it survives an app restart. */
const CART_KEY = 'cart';

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
  // Flips true once we've read any persisted cart back in. It gates the write-back effect
  // (so the initial empty state can't clobber a saved cart) AND, being state, re-triggers that
  // effect when it flips — persisting a cart the buyer built before hydration resolved.
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once on mount. If the buyer already added something before the async
  // read resolved, keep their in-flight cart rather than overwriting it.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CART_KEY)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          try {
            const saved = JSON.parse(raw) as CartLine[];
            if (Array.isArray(saved)) {
              setLines((cur) => (cur.length ? cur : saved));
            }
          } catch {
            // ignore a corrupt cart blob — start empty
          }
        }
        setHydrated(true);
      })
      .catch(() => {
        setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Persist on every change once hydrated. Fire-and-forget; a write failure is non-fatal.
  // Runs when `hydrated` first flips true too, so a pre-hydration add gets saved.
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(lines)).catch(() => {});
  }, [lines, hydrated]);

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
