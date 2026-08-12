import { OrderStatus } from '@payflow/database';

import {
  assertOrderTransition,
  InvalidOrderTransitionError,
} from './order-state-machine';

describe('Order state machine', () => {
  it.each([
    [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID],
    [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
    [OrderStatus.PAID, OrderStatus.FULFILLED],
    [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED],
    [OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertOrderTransition(from, to)).not.toThrow();
  });

  it.each([
    [OrderStatus.CANCELLED, OrderStatus.PAID],
    [OrderStatus.PAID, OrderStatus.CANCELLED],
    [OrderStatus.REFUNDED, OrderStatus.PAID],
    [OrderStatus.PENDING_PAYMENT, OrderStatus.REFUNDED],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertOrderTransition(from, to)).toThrow(
      InvalidOrderTransitionError,
    );
  });
});
