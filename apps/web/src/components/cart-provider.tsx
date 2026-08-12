'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { Product } from '@/lib/api';

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  addItem: (product: Product, quantity?: number) => void;
  clear: () => void;
  count: number;
  items: CartItem[];
  ready: boolean;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
}

const CART_KEY = 'payflow.stage2.cart';
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(CART_KEY);
    let restoredItems: CartItem[] = [];
    let active = true;

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (isCart(parsed)) {
          restoredItems = parsed;
        }
      } catch {
        window.sessionStorage.removeItem(CART_KEY);
      }
    }

    queueMicrotask(() => {
      if (active) {
        setItems(restoredItems);
        setReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (ready) {
      window.sessionStorage.setItem(CART_KEY, JSON.stringify(items));
    }
  }, [items, ready]);

  const addItem = useCallback((product: Product, quantity = 1): void => {
    setItems((current) => {
      const existing = current.find((item) => item.product.id === product.id);

      if (!existing) {
        return [
          ...current,
          { product, quantity: clampQuantity(quantity, product.stock) },
        ];
      }

      return current.map((item) =>
        item.product.id === product.id
          ? {
              product,
              quantity: clampQuantity(item.quantity + quantity, product.stock),
            }
          : item,
      );
    });
  }, []);

  const clear = useCallback((): void => setItems([]), []);
  const removeItem = useCallback((productId: string): void => {
    setItems((current) =>
      current.filter((item) => item.product.id !== productId),
    );
  }, []);
  const updateQuantity = useCallback(
    (productId: string, quantity: number): void => {
      setItems((current) =>
        current.map((item) =>
          item.product.id === productId
            ? {
                ...item,
                quantity: clampQuantity(quantity, item.product.stock),
              }
            : item,
        ),
      );
    },
    [],
  );
  const count = items.reduce((total, item) => total + item.quantity, 0);
  const value = useMemo<CartContextValue>(
    () => ({
      addItem,
      clear,
      count,
      items,
      ready,
      removeItem,
      updateQuantity,
    }),
    [addItem, clear, count, items, ready, removeItem, updateQuantity],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error('useCart must be used inside CartProvider.');
  }

  return context;
}

function clampQuantity(quantity: number, stock: number): number {
  return Math.min(Math.max(Math.trunc(quantity) || 1, 1), stock, 99);
}

function isCart(value: unknown): value is CartItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'product' in item &&
        typeof item.product === 'object' &&
        item.product !== null &&
        'id' in item.product &&
        typeof item.product.id === 'string' &&
        'quantity' in item &&
        typeof item.quantity === 'number' &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    )
  );
}
