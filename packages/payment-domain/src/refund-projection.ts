import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@payflow/database';

import {
  assertOrderTransition,
  assertPaymentTransition,
  assertRefundTransition,
} from './state-machines';
import { appendRefundSucceededEvent } from './outbox';

export interface ProviderRefundSnapshot {
  amount: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  providerPaymentId: string | null;
  providerRefundId: string;
  providerRequestId: string | null;
  status: RefundStatus;
}

export interface RefundProjectionResult {
  error: string | null;
  stale: boolean;
  status: RefundStatus | null;
}

export async function applyProviderRefundSnapshot(
  transaction: Prisma.TransactionClient,
  refundId: string,
  snapshot: ProviderRefundSnapshot,
): Promise<RefundProjectionResult> {
  const locator = await transaction.refund.findUnique({
    where: { id: refundId },
    select: { payment: { select: { orderId: true } } },
  });

  if (!locator) {
    return failure('The local refund does not exist.');
  }

  await transaction.$queryRaw(
    Prisma.sql`SELECT 1::integer AS acquired
      FROM pg_advisory_xact_lock(hashtextextended(${locator.payment.orderId}, 0))`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "orders"
      WHERE "id" = CAST(${locator.payment.orderId} AS UUID) FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "payments"
      WHERE "id" = (SELECT "payment_id" FROM "refunds"
        WHERE "id" = CAST(${refundId} AS UUID)) FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "refunds"
      WHERE "id" = CAST(${refundId} AS UUID) FOR UPDATE`,
  );

  const refund = await transaction.refund.findUnique({
    where: { id: refundId },
    include: { payment: { include: { order: true } } },
  });

  if (!refund) {
    return failure('The local refund disappeared during processing.');
  }

  if (
    refund.amount !== snapshot.amount ||
    refund.payment.currency !== snapshot.currency ||
    !refund.payment.providerPaymentId ||
    refund.payment.providerPaymentId !== snapshot.providerPaymentId ||
    (refund.providerRefundId !== null &&
      refund.providerRefundId !== snapshot.providerRefundId)
  ) {
    return failure(
      'Provider refund identifiers, amount, or currency mismatch.',
    );
  }

  if (refund.status !== snapshot.status) {
    try {
      assertRefundTransition(refund.status, snapshot.status);
    } catch {
      return { error: null, stale: true, status: refund.status };
    }
  }

  const succeededOther = await transaction.refund.aggregate({
    where: {
      id: { not: refund.id },
      paymentId: refund.paymentId,
      status: RefundStatus.SUCCEEDED,
    },
    _sum: { amount: true },
  });
  const succeededTotal =
    (succeededOther._sum.amount ?? 0) +
    (snapshot.status === RefundStatus.SUCCEEDED ? refund.amount : 0);

  if (succeededTotal > refund.payment.amount) {
    return failure('Succeeded refunds exceed the original payment amount.');
  }

  const projection =
    snapshot.status === RefundStatus.SUCCEEDED
      ? projectAggregateState(
          refund.payment.status,
          refund.payment.order.status,
          succeededTotal,
          refund.payment.amount,
        )
      : null;

  if (projection?.error) {
    return failure(projection.error);
  }

  await transaction.refund.update({
    where: { id: refund.id },
    data: {
      failureCode: snapshot.failureCode,
      failureMessage: snapshot.failureMessage,
      providerRefundId: snapshot.providerRefundId,
      providerRequestId: snapshot.providerRequestId,
      status: snapshot.status,
    },
  });

  if (projection && projection.paymentStatus !== refund.payment.status) {
    await transaction.payment.update({
      where: { id: refund.payment.id },
      data: { status: projection.paymentStatus },
    });
  }

  if (projection && projection.orderStatus !== refund.payment.order.status) {
    await transaction.order.update({
      where: { id: refund.payment.order.id },
      data: { status: projection.orderStatus },
    });
  }

  if (snapshot.status === RefundStatus.SUCCEEDED) {
    await appendRefundSucceededEvent(transaction, {
      amount: refund.amount,
      currency: refund.payment.currency,
      orderId: refund.payment.orderId,
      paymentId: refund.paymentId,
      provider: refund.payment.provider,
      providerPaymentId: refund.payment.providerPaymentId,
      refundId: refund.id,
    });
  }

  return { error: null, stale: false, status: snapshot.status };
}

function projectAggregateState(
  paymentStatus: PaymentStatus,
  orderStatus: OrderStatus,
  succeededTotal: number,
  paymentAmount: number,
): {
  error: string | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
} {
  const full = succeededTotal === paymentAmount;
  const targetPayment = full
    ? PaymentStatus.REFUNDED
    : PaymentStatus.PARTIALLY_REFUNDED;
  const targetOrder = full
    ? OrderStatus.REFUNDED
    : OrderStatus.PARTIALLY_REFUNDED;

  try {
    if (paymentStatus !== targetPayment) {
      assertPaymentTransition(paymentStatus, targetPayment);
    }

    if (orderStatus !== targetOrder) {
      if (full && orderStatus === OrderStatus.PAID) {
        assertOrderTransition(orderStatus, OrderStatus.PARTIALLY_REFUNDED);
        assertOrderTransition(
          OrderStatus.PARTIALLY_REFUNDED,
          OrderStatus.REFUNDED,
        );
      } else {
        assertOrderTransition(orderStatus, targetOrder);
      }
    }
  } catch {
    return {
      error: `Refund aggregate cannot project ${paymentStatus}/${orderStatus} to ${targetPayment}/${targetOrder}.`,
      orderStatus,
      paymentStatus,
    };
  }

  return {
    error: null,
    orderStatus: targetOrder,
    paymentStatus: targetPayment,
  };
}

function failure(error: string): RefundProjectionResult {
  return { error, stale: false, status: null };
}
