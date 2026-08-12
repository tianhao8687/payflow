'use client';

import { useState } from 'react';

import type { Product } from '@/lib/api';

import { useCart } from './cart-provider';

export function AddToCartButton({
  className,
  product,
}: {
  className?: string;
  product: Product;
}) {
  const { addItem } = useCart();
  const [announcement, setAnnouncement] = useState('');
  const soldOut = product.stock < 1;

  return (
    <>
      <button
        className={className}
        disabled={soldOut}
        onClick={() => {
          addItem(product);
          setAnnouncement(`${product.name} added to cart.`);
        }}
        type="button"
      >
        {soldOut ? 'Out of stock' : 'Add to cart'}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
