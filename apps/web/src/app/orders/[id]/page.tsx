import type { Metadata } from 'next';

import { OrderDetail } from '@/components/order-detail';

export const metadata: Metadata = {
  title: 'Order detail',
};

export default async function OrderRoute({
  params,
}: PageProps<'/orders/[id]'>) {
  const { id } = await params;

  return (
    <main id="main-content">
      <OrderDetail id={id} />
    </main>
  );
}
