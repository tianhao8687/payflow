import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  isTransactionWriteConflict,
} from '@payflow/database';

import { DatabaseService } from '../database/database.service';

export type CheckoutOrder = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

export type PaymentWithCount = Prisma.PaymentGetPayload<{
  include: {
    _count: { select: { attempts: true } };
    refunds: true;
  };
}>;

export interface PaymentReservation {
  created: boolean;
  order: CheckoutOrder;
  payment: PaymentWithCount | null;
}

export interface CompletedCheckoutData {
  checkoutExpiresAt: Date;
  checkoutUrl: string;
  providerCheckoutSessionId: string;
  providerPaymentId: string | null;
  providerRequestId: string | null;
}

const withAttemptCount = {
  _count: { select: { attempts: true } },
  refunds: { orderBy: { createdAt: 'desc' as const } },
} as const;

@Injectable()
export class PaymentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async reservePayment(
    orderId: string,
    userId: string,
    provider: PaymentProvider,
  ): Promise<PaymentReservation | null> {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            await transaction.$queryRaw(
              Prisma.sql`SELECT 1::integer AS acquired
                FROM pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`,
            );

            const order = await transaction.order.findFirst({
              where: { id: orderId, userId },
              include: { items: { orderBy: { skuSnapshot: 'asc' } } },
            });

            if (!order) {
              return null;
            }

            if (
              order.status !== OrderStatus.PENDING_PAYMENT ||
              order.totalAmount <= 0
            ) {
              return { created: false, order, payment: null };
            }

            const active = await transaction.payment.findFirst({
              where: { orderId, status: { not: PaymentStatus.FAILED } },
              orderBy: { attemptNo: 'desc' },
              include: withAttemptCount,
            });

            if (active) {
              return { created: false, order, payment: active };
            }

            const latest = await transaction.payment.findFirst({
              where: { orderId, provider },
              orderBy: { attemptNo: 'desc' },
              select: { attemptNo: true },
            });

            const attemptNo = (latest?.attemptNo ?? 0) + 1;
            const payment = await transaction.payment.create({
              data: {
                amount: order.totalAmount,
                attemptNo,
                currency: order.currency,
                idempotencyKey: `payment:create:${provider.toLowerCase()}:${order.id}:${attemptNo}`,
                orderId: order.id,
                provider,
                status: PaymentStatus.CREATED,
              },
              include: withAttemptCount,
            });

            return { created: true, order, payment };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error: unknown) {
        if (isTransactionWriteConflict(error) && retry < 2) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Payment reservation retry limit was exhausted.');
  }

  startProviderAttempt(paymentId: string): Promise<{ id: string }> {
    return this.database.prisma.paymentAttempt.create({
      data: {
        paymentId,
        status: PaymentAttemptStatus.STARTED,
      },
      select: { id: true },
    });
  }

  completeCheckoutSession(
    paymentId: string,
    providerAttemptId: string,
    data: CompletedCheckoutData,
  ): Promise<PaymentWithCount> {
    return this.database.prisma.$transaction(async (transaction) => {
      const current = await transaction.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });

      if (
        current.providerCheckoutSessionId &&
        current.providerCheckoutSessionId !== data.providerCheckoutSessionId
      ) {
        throw new Error(
          'Provider idempotency replay returned a different Checkout Session.',
        );
      }

      const payment = current.providerCheckoutSessionId
        ? current
        : await transaction.payment.update({
            where: { id: paymentId },
            data: {
              checkoutExpiresAt: data.checkoutExpiresAt,
              checkoutUrl: data.checkoutUrl,
              providerCheckoutSessionId: data.providerCheckoutSessionId,
              providerPaymentId: data.providerPaymentId,
              status: PaymentStatus.PENDING,
            },
          });

      await transaction.paymentAttempt.update({
        where: { id: providerAttemptId },
        data: {
          providerRequestId: data.providerRequestId,
          status: PaymentAttemptStatus.SUCCEEDED,
        },
      });

      return transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: withAttemptCount,
      });
    });
  }

  async failProviderAttempt(
    providerAttemptId: string,
    errorCode: string,
    errorMessage: string,
    providerRequestId: string | null,
  ): Promise<void> {
    await this.database.prisma.paymentAttempt.update({
      where: { id: providerAttemptId },
      data: {
        errorCode,
        errorMessage,
        providerRequestId,
        status: PaymentAttemptStatus.FAILED,
      },
    });
  }

  findOwnedById(
    paymentId: string,
    userId: string,
  ): Promise<PaymentWithCount | null> {
    return this.database.prisma.payment.findFirst({
      where: { id: paymentId, order: { userId } },
      include: withAttemptCount,
    });
  }
}
