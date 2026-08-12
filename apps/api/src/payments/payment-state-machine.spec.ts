import { PaymentStatus } from '@payflow/database';

import {
  assertPaymentTransition,
  InvalidPaymentTransitionError,
} from './payment-state-machine';

describe('Payment state machine', () => {
  it.each([
    [PaymentStatus.CREATED, PaymentStatus.PENDING],
    [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
    [PaymentStatus.PENDING, PaymentStatus.SUCCEEDED],
    [PaymentStatus.PROCESSING, PaymentStatus.FAILED],
    [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED],
    [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertPaymentTransition(from, to)).not.toThrow();
  });

  it.each([
    [PaymentStatus.FAILED, PaymentStatus.PENDING],
    [PaymentStatus.SUCCEEDED, PaymentStatus.PENDING],
    [PaymentStatus.REFUNDED, PaymentStatus.SUCCEEDED],
    [PaymentStatus.CREATED, PaymentStatus.SUCCEEDED],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertPaymentTransition(from, to)).toThrow(
      InvalidPaymentTransitionError,
    );
  });
});
