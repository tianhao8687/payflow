import type { Metadata } from 'next';

import { CartPage } from '@/components/cart-page';

export const metadata: Metadata = {
  title: 'Cart',
};

export default function CartRoute() {
  return (
    <main id="main-content">
      <CartPage />
    </main>
  );
}
