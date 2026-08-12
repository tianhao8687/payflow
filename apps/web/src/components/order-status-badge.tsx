import type { OrderStatus } from '@/lib/api';

const labels: Record<OrderStatus, string> = {
  CANCELLED: 'Cancelled',
  FULFILLED: 'Fulfilled',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partially refunded',
  PENDING_PAYMENT: 'Pending payment',
  REFUNDED: 'Refunded',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const active = status === 'PENDING_PAYMENT';

  return (
    <span
      className={`inline-flex w-fit rounded-full px-3 py-1 font-mono text-xs font-bold tracking-[0.06em] uppercase ${
        active
          ? 'bg-[#fff3d6] text-[#785000]'
          : status === 'CANCELLED'
            ? 'bg-[#eef1f5] text-[#555b66]'
            : 'bg-[#e8f8f4] text-[#087f6a]'
      }`}
    >
      {labels[status]}
    </span>
  );
}
