import { OrderStatus, PaymentStatus, RefundStatus } from '@payflow/database';

const orderTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
    [OrderStatus.PAID]: [OrderStatus.FULFILLED, OrderStatus.PARTIALLY_REFUNDED],
    [OrderStatus.FULFILLED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
    [OrderStatus.REFUNDED]: [],
  };

const paymentTransitions: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  [PaymentStatus.CREATED]: [PaymentStatus.PENDING, PaymentStatus.FAILED],
  [PaymentStatus.PENDING]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  [PaymentStatus.SUCCEEDED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED],
  [PaymentStatus.REFUNDED]: [],
};

const refundTransitions: Readonly<
  Record<RefundStatus, readonly RefundStatus[]>
> = {
  [RefundStatus.PENDING]: [RefundStatus.SUCCEEDED, RefundStatus.FAILED],
  [RefundStatus.SUCCEEDED]: [],
  [RefundStatus.FAILED]: [],
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

export class InvalidPaymentTransitionError extends Error {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Payment cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidPaymentTransitionError';
  }
}

export class InvalidRefundTransitionError extends Error {
  constructor(
    readonly from: RefundStatus,
    readonly to: RefundStatus,
  ) {
    super(`Refund cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidRefundTransitionError';
  }
}

export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!orderTransitions[from].includes(to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (!paymentTransitions[from].includes(to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}

export function assertRefundTransition(
  from: RefundStatus,
  to: RefundStatus,
): void {
  if (!refundTransitions[from].includes(to)) {
    throw new InvalidRefundTransitionError(from, to);
  }
}
