import type { Metadata } from 'next';

import { PaymentResult } from '@/components/payment-result';

export const metadata: Metadata = {
  title: 'Payment result',
};

export default async function PaymentResultRoute({
  params,
}: PageProps<'/payments/[id]/result'>) {
  const { id } = await params;

  return (
    <main id="main-content">
      <PaymentResult paymentId={id} />
    </main>
  );
}
