import { RefundStatus } from '@payflow/database';

const allowedTransitions: Readonly<
  Record<RefundStatus, readonly RefundStatus[]>
> = {
  [RefundStatus.PENDING]: [RefundStatus.SUCCEEDED, RefundStatus.FAILED],
  [RefundStatus.SUCCEEDED]: [],
  [RefundStatus.FAILED]: [],
};

export class InvalidRefundTransitionError extends Error {
  constructor(
    readonly from: RefundStatus,
    readonly to: RefundStatus,
  ) {
    super(`Refund cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidRefundTransitionError';
  }
}

export function assertRefundTransition(
  from: RefundStatus,
  to: RefundStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidRefundTransitionError(from, to);
  }
}
