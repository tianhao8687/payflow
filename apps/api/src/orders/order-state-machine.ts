import { OrderStatus } from '@payflow/database';

const allowedTransitions: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.FULFILLED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.FULFILLED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
};

export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Order cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidOrderTransitionError';
  }
}

export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}
