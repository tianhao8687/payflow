import { RefundStatus } from '@payflow/database';

import {
  InvalidRefundTransitionError,
  assertRefundTransition,
} from './refund-state-machine';

describe('refund state machine', () => {
  it.each([
    [RefundStatus.PENDING, RefundStatus.SUCCEEDED],
    [RefundStatus.PENDING, RefundStatus.FAILED],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertRefundTransition(from, to)).not.toThrow();
  });

  it.each([
    [RefundStatus.SUCCEEDED, RefundStatus.FAILED],
    [RefundStatus.FAILED, RefundStatus.SUCCEEDED],
    [RefundStatus.SUCCEEDED, RefundStatus.PENDING],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertRefundTransition(from, to)).toThrow(
      InvalidRefundTransitionError,
    );
  });
});
