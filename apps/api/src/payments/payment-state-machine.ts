import { PaymentStatus } from '@payflow/database';

const allowedTransitions: Readonly<
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

export class InvalidPaymentTransitionError extends Error {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Payment cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidPaymentTransitionError';
  }
}

export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}
