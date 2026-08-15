import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  type PrismaClient,
} from '@payflow/database';
import {
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  PaymentProviderRegistry,
  type ProviderPayment,
  ProviderPaymentStatus,
} from '@payflow/payment-core';

import { appendPaymentSucceededEvent } from './outbox';
import {
  assertOrderTransition,
  assertPaymentTransition,
} from './state-machines';

export interface PaymentRecoveryResult {
  changed: boolean;
  paymentId: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
}

export interface PaymentRecoveryBatchResult {
  errors: number;
  recovered: number;
  scanned: number;
}

export class PaymentRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async recoverExpiredPayment(
    paymentId: string,
  ): Promise<PaymentRecoveryResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new Error('Payment recovery target does not exist.');
    }
    const provider = this.providers.require(payment.provider);
    if (!provider.isConfigured(PaymentProviderCapability.PAYMENT)) {
      throw new PaymentProviderError(
        provider.name,
        'GET_PAYMENT',
        'PROVIDER_NOT_CONFIGURED',
        'Payment provider is not configured for recovery.',
      );
    }
    const remote = await lookupPayment(provider, payment);
    validateSnapshot(payment, remote);

    if (remote.status === ProviderPaymentStatus.PENDING) {
      if (!provider.cancelPayment) {
        throw new PaymentProviderError(
          provider.name,
          'CANCEL_PAYMENT',
          'PAYMENT_CLOSE_UNSUPPORTED',
          'The provider cannot safely close the expired payment.',
          remote.providerRequestId,
          true,
          true,
        );
      }
      const closed = await provider.cancelPayment({
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey: `payment:close:${payment.id}`,
        merchantReference: payment.id,
        providerCheckoutSessionId: payment.providerCheckoutSessionId,
        providerPaymentId:
          remote.providerPaymentId ?? payment.providerPaymentId,
      });
      validateSnapshot(payment, closed);
      return this.project(payment.id, closed);
    }
    if (remote.status === ProviderPaymentStatus.PROCESSING) {
      throw new PaymentProviderError(
        provider.name,
        'GET_PAYMENT',
        'PAYMENT_RECOVERY_STILL_PROCESSING',
        'The expired provider payment is still processing.',
        remote.providerRequestId,
        true,
        true,
      );
    }
    return this.project(payment.id, remote);
  }

  async recoverExpiredBatch(
    now = new Date(),
    limit = 50,
  ): Promise<PaymentRecoveryBatchResult> {
    const payments = await this.prisma.payment.findMany({
      where: {
        checkoutExpiresAt: { lte: now },
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
      orderBy: [{ checkoutExpiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 200),
    });
    let errors = 0;
    let recovered = 0;
    await mapWithConcurrency(payments, 4, async ({ id }) => {
      try {
        const result = await this.recoverExpiredPayment(id);
        if (result.changed) {
          recovered += 1;
        }
      } catch {
        errors += 1;
      }
    });
    return { errors, recovered, scanned: payments.length };
  }

  private async project(
    paymentId: string,
    remote: ProviderPayment,
  ): Promise<PaymentRecoveryResult> {
    return this.prisma.$transaction(async (transaction) => {
      const locator = await transaction.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderId: true },
      });
      await transaction.$queryRaw(
        Prisma.sql`SELECT 1::integer AS acquired
          FROM pg_advisory_xact_lock(hashtextextended(${locator.orderId}, 0))`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "orders"
          WHERE "id" = CAST(${locator.orderId} AS UUID) FOR UPDATE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payments"
          WHERE "id" = CAST(${paymentId} AS UUID) FOR UPDATE`,
      );
      const payment = await transaction.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { order: true },
      });
      validateSnapshot(payment, remote);
      const target = localStatus(remote.status);
      if (
        new Set<PaymentStatus>([
          PaymentStatus.SUCCEEDED,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.REFUNDED,
        ]).has(payment.status) &&
        target !== PaymentStatus.SUCCEEDED
      ) {
        return {
          changed: false,
          paymentId,
          providerPaymentId: payment.providerPaymentId,
          status: payment.status,
        };
      }
      if (target === PaymentStatus.SUCCEEDED && !remote.providerPaymentId) {
        throw new Error('Successful provider recovery has no transaction ID.');
      }
      const changed = payment.status !== target;
      if (changed) {
        assertPaymentTransition(payment.status, target);
      }
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId:
            payment.providerPaymentId ?? remote.providerPaymentId,
          status: target,
        },
      });
      if (
        target === PaymentStatus.SUCCEEDED &&
        payment.order.status === OrderStatus.PENDING_PAYMENT
      ) {
        assertOrderTransition(payment.order.status, OrderStatus.PAID);
        await transaction.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID },
        });
      }
      if (target === PaymentStatus.SUCCEEDED) {
        await appendPaymentSucceededEvent(transaction, {
          amount: payment.amount,
          currency: payment.currency,
          orderId: payment.orderId,
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: remote.providerPaymentId!,
        });
      }
      return {
        changed,
        paymentId,
        providerPaymentId:
          payment.providerPaymentId ?? remote.providerPaymentId,
        status: target,
      };
    });
  }
}

async function lookupPayment(
  provider: PaymentProvider,
  payment: {
    amount: number;
    currency: string;
    id: string;
    providerCheckoutSessionId: string | null;
    providerPaymentId: string | null;
  },
): Promise<ProviderPayment> {
  if (provider.getPaymentByReference) {
    return provider.getPaymentByReference({
      amount: payment.amount,
      currency: payment.currency,
      merchantReference: payment.id,
      providerCheckoutSessionId: payment.providerCheckoutSessionId,
      providerPaymentId: payment.providerPaymentId,
    });
  }
  if (!payment.providerPaymentId) {
    throw new PaymentProviderError(
      provider.name,
      'GET_PAYMENT',
      'PAYMENT_REFERENCE_MISSING',
      'The payment has no provider reference for recovery.',
    );
  }
  return provider.getPayment(payment.providerPaymentId);
}

function validateSnapshot(
  payment: {
    amount: number;
    currency: string;
    providerPaymentId: string | null;
  },
  remote: ProviderPayment,
): void {
  if (
    payment.amount !== remote.amount ||
    payment.currency !== remote.currency ||
    (payment.providerPaymentId &&
      remote.providerPaymentId &&
      payment.providerPaymentId !== remote.providerPaymentId)
  ) {
    throw new Error('Provider recovery snapshot does not match local payment.');
  }
}

function localStatus(status: ProviderPaymentStatus): PaymentStatus {
  switch (status) {
    case ProviderPaymentStatus.PENDING:
      return PaymentStatus.PENDING;
    case ProviderPaymentStatus.PROCESSING:
      return PaymentStatus.PROCESSING;
    case ProviderPaymentStatus.SUCCEEDED:
      return PaymentStatus.SUCCEEDED;
    case ProviderPaymentStatus.FAILED:
      return PaymentStatus.FAILED;
  }
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= values.length) {
          return;
        }
        await mapper(values[index]!);
      }
    }),
  );
}
