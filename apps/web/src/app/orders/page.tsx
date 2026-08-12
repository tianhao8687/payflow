import type { Metadata } from 'next';

import { OrdersPage } from '@/components/orders-page';

export const metadata: Metadata = {
  title: 'Orders',
};

export default function OrdersRoute() {
  return (
    <main id="main-content">
      <OrdersPage />
    </main>
  );
}
