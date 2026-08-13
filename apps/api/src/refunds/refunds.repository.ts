import { Injectable } from '@nestjs/common';
import {
  AuditActorType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundStatus,
  isTransactionWriteConflict,
} from '@payflow/database';

import { DatabaseService } from '../database/database.service';
import type { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import {
  type ProviderRefundSnapshot,
  applyProviderRefundSnapshot,
} from './refund-state-projection';
import { assertRefundTransition } from './refund-state-machine';

export type RefundWithPayment = Prisma.RefundGetPayload<{
  include: { payment: { include: { order: true } } };
}>;

export interface RefundMutationResult {
  changed: boolean;
  refund: RefundWithPayment;
}

export type RefundReservation =
  | { kind: 'NOT_FOUND' }
  | { kind: 'NOT_REFUNDABLE'; status: PaymentStatus }
  | { kind: 'PROVIDER_REFERENCE_MISSING' }
  | { availableAmount: number; kind: 'AMOUNT_EXCEEDED' }
  | { created: boolean; kind: 'RESERVED'; refund: RefundWithPayment };

@Injectable()
export class RefundsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findPaymentProvider(
    paymentId: string,
  ): Promise<PaymentProvider | null> {
    const payment = await this.database.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { provider: true },
    });
    return payment?.provider ?? null;
  }

  async reserve(
    paymentId: string,
    actorId: string,
    request: CreateRefundRequestDto,
    provider: PaymentProvider,
  ): Promise<RefundReservation> {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            const locator = await transaction.payment.findUnique({
              where: { id: paymentId },
              select: { orderId: true },
            });

            if (!locator) {
              return { kind: 'NOT_FOUND' };
            }

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

            const payment = await transaction.payment.findUnique({
              where: { id: paymentId },
              include: { order: true },
            });

            if (!payment) {
              return { kind: 'NOT_FOUND' };
            }

            const existing = await transaction.refund.findUnique({
              where: {
                paymentId_refundRequestId: {
                  paymentId,
                  refundRequestId: request.refundRequestId,
                },
              },
              include: { payment: { include: { order: true } } },
            });

            if (existing) {
              return {
                created: false,
                kind: 'RESERVED',
                refund: existing,
              };
            }

            if (
              payment.provider !== provider ||
              !new Set<PaymentStatus>([
                PaymentStatus.SUCCEEDED,
                PaymentStatus.PARTIALLY_REFUNDED,
              ]).has(payment.status) ||
              !new Set<OrderStatus>([
                OrderStatus.PAID,
                OrderStatus.PARTIALLY_REFUNDED,
              ]).has(payment.order.status)
            ) {
              return { kind: 'NOT_REFUNDABLE', status: payment.status };
            }

            if (!payment.providerPaymentId) {
              return { kind: 'PROVIDER_REFERENCE_MISSING' };
            }

            const reserved = await transaction.refund.aggregate({
              where: {
                paymentId,
                status: { in: [RefundStatus.PENDING, RefundStatus.SUCCEEDED] },
              },
              _sum: { amount: true },
            });
            const availableAmount =
              payment.amount - (reserved._sum.amount ?? 0);
            const amount = request.amount ?? availableAmount;

            if (amount < 1 || amount > availableAmount) {
              return { availableAmount, kind: 'AMOUNT_EXCEEDED' };
            }

            const refund = await transaction.refund.create({
              data: {
                amount,
                idempotencyKey: `refund:create:${payment.id}:${request.refundRequestId}`,
                paymentId: payment.id,
                reason: request.reason.trim(),
                refundRequestId: request.refundRequestId,
                status: RefundStatus.PENDING,
              },
              include: { payment: { include: { order: true } } },
            });

            await transaction.auditLog.create({
              data: {
                action: 'REFUND_REQUESTED',
                actorId,
                actorType: AuditActorType.ADMIN,
                metadataJson: {
                  amount,
                  paymentId,
                  reason: request.reason.trim(),
                  refundRequestId: request.refundRequestId,
                },
                targetId: refund.id,
                targetType: 'REFUND',
              },
            });

            return { created: true, kind: 'RESERVED', refund };
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

    throw new Error('Refund reservation retry limit was exhausted.');
  }

  async applyProviderResult(
    refundId: string,
    actorId: string,
    snapshot: ProviderRefundSnapshot,
  ): Promise<RefundMutationResult> {
    return this.database.prisma.$transaction(
      async (transaction) => {
        const projection = await applyProviderRefundSnapshot(
          transaction,
          refundId,
          snapshot,
        );

        if (projection.error) {
          throw new Error(projection.error);
        }

        await transaction.auditLog.create({
          data: {
            action: `REFUND_PROVIDER_${snapshot.status}`,
            actorId,
            actorType: AuditActorType.ADMIN,
            metadataJson: {
              providerRefundId: snapshot.providerRefundId,
              status: snapshot.status,
            },
            targetId: refundId,
            targetType: 'REFUND',
          },
        });

        const refund = await transaction.refund.findUniqueOrThrow({
          where: { id: refundId },
          include: { payment: { include: { order: true } } },
        });
        return { changed: projection.changed, refund };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async recordProviderFailure(
    refundId: string,
    actorId: string,
    code: string,
    message: string,
    requestId: string | null,
  ): Promise<RefundMutationResult> {
    return this.database.prisma.$transaction(async (transaction) => {
      const locator = await transaction.refund.findUniqueOrThrow({
        where: { id: refundId },
        select: { payment: { select: { orderId: true } } },
      });
      await transaction.$queryRaw(
        Prisma.sql`SELECT 1::integer AS acquired
          FROM pg_advisory_xact_lock(hashtextextended(${locator.payment.orderId}, 0))`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "refunds"
          WHERE "id" = CAST(${refundId} AS UUID) FOR UPDATE`,
      );
      const current = await transaction.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: { payment: { include: { order: true } } },
      });

      if (current.status !== RefundStatus.PENDING) {
        return { changed: false, refund: current };
      }

      assertRefundTransition(current.status, RefundStatus.FAILED);
      const refund = await transaction.refund.update({
        where: { id: refundId },
        data: {
          failureCode: code.slice(0, 100),
          failureMessage: message.slice(0, 500),
          providerRequestId: requestId,
          status: RefundStatus.FAILED,
        },
        include: { payment: { include: { order: true } } },
      });

      await transaction.auditLog.create({
        data: {
          action: 'REFUND_PROVIDER_FAILED',
          actorId,
          actorType: AuditActorType.ADMIN,
          metadataJson: { code: code.slice(0, 100) },
          targetId: refundId,
          targetType: 'REFUND',
        },
      });

      return { changed: true, refund };
    });
  }
}
