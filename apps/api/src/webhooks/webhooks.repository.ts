import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  AuditActorType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundStatus,
  WebhookEventStatus,
} from '@payflow/database';
import {
  type ProviderPaymentTransitionAction,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type VerifiedWebhookEvent,
} from '@payflow/payment-core';

import { DatabaseService } from '../database/database.service';
import {
  InvalidOrderTransitionError,
  assertOrderTransition,
} from '../orders/order-state-machine';
import {
  InvalidPaymentTransitionError,
  assertPaymentTransition,
} from '../payments/payment-state-machine';
import { applyProviderRefundSnapshot } from '../refunds/refund-state-projection';

export interface WebhookProcessingResult {
  duplicate: boolean;
  status: WebhookEventStatus;
}

interface WebhookActionResult {
  processingError: string | null;
  status: WebhookEventStatus;
}

@Injectable()
export class WebhooksRepository {
  constructor(private readonly database: DatabaseService) {}

  async processProviderEvent(
    event: VerifiedWebhookEvent,
  ): Promise<WebhookProcessingResult> {
    const provider = this.databaseProvider(event.provider);

    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            await transaction.$queryRaw(
              Prisma.sql`SELECT 1::integer AS acquired
                FROM pg_advisory_xact_lock(hashtextextended(${event.providerEventId}, 0))`,
            );

            const existing = await transaction.webhookEvent.findUnique({
              where: { providerEventId: event.providerEventId },
              select: { status: true },
            });

            if (existing) {
              const duplicate = await transaction.webhookEvent.update({
                where: { providerEventId: event.providerEventId },
                data: {
                  deliveryCount: { increment: 1 },
                  lastReceivedAt: new Date(),
                },
                select: { status: true },
              });

              return { duplicate: true, status: duplicate.status };
            }

            const webhookEvent = await transaction.webhookEvent.create({
              data: {
                eventType: event.eventType,
                payloadJson: JSON.parse(
                  JSON.stringify(event.payload),
                ) as Prisma.InputJsonValue,
                provider,
                providerEventId: event.providerEventId,
              },
              select: { id: true },
            });

            let result: WebhookActionResult;

            if (event.action.kind === 'IGNORE') {
              result = {
                processingError: event.action.reason,
                status: WebhookEventStatus.IGNORED,
              };
            } else if (event.action.kind === 'REJECT') {
              result = {
                processingError: event.action.reason,
                status: WebhookEventStatus.FAILED,
              };
            } else if (event.action.kind === 'REFUND_SYNC') {
              const localStatus = this.localRefundStatus(event.action.status);
              const projection = await applyProviderRefundSnapshot(
                transaction,
                event.action.refundId,
                { ...event.action, status: localStatus },
              );

              if (!projection.error && !projection.stale) {
                await transaction.auditLog.create({
                  data: {
                    action: `REFUND_WEBHOOK_${localStatus}`,
                    actorType: AuditActorType.SYSTEM,
                    metadataJson: {
                      providerEventId: event.providerEventId,
                      providerRefundId: event.action.providerRefundId,
                    },
                    targetId: event.action.refundId,
                    targetType: 'REFUND',
                  },
                });
              }

              result = projection.error
                ? {
                    processingError: projection.error,
                    status: WebhookEventStatus.FAILED,
                  }
                : projection.stale
                  ? {
                      processingError:
                        'The refund event would regress a terminal local state.',
                      status: WebhookEventStatus.IGNORED,
                    }
                  : {
                      processingError: null,
                      status: WebhookEventStatus.PROCESSED,
                    };
            } else {
              result = await this.processPaymentTransition(
                transaction,
                provider,
                event.action,
              );
            }

            await transaction.webhookEvent.update({
              where: { id: webhookEvent.id },
              data: {
                processedAt: new Date(),
                processingError: result.processingError,
                status: result.status,
              },
            });

            return { duplicate: false, status: result.status };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          retry < 2
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Webhook processing retry limit was exhausted.');
  }

  private async processPaymentTransition(
    transaction: Prisma.TransactionClient,
    provider: PaymentProvider,
    action: ProviderPaymentTransitionAction,
  ): Promise<WebhookActionResult> {
    const targetStatus = this.localPaymentStatus(action.targetStatus);
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1::integer AS acquired
        FROM pg_advisory_xact_lock(hashtextextended(${action.orderId}, 0))`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id"
        FROM "orders"
        WHERE "id" = CAST(${action.orderId} AS UUID)
        FOR UPDATE`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id"
        FROM "payments"
        WHERE "id" = CAST(${action.paymentId} AS UUID)
        FOR UPDATE`,
    );

    const payment = await transaction.payment.findUnique({
      where: { id: action.paymentId },
      include: { order: true },
    });

    if (
      !payment ||
      payment.provider !== provider ||
      payment.orderId !== action.orderId ||
      action.amount !== payment.amount ||
      action.currency !== payment.currency ||
      (action.providerCheckoutSessionId !== null &&
        action.providerCheckoutSessionId !==
          payment.providerCheckoutSessionId) ||
      (payment.providerPaymentId !== null &&
        action.providerPaymentId !== null &&
        payment.providerPaymentId !== action.providerPaymentId) ||
      (targetStatus === PaymentStatus.SUCCEEDED &&
        action.providerPaymentId === null)
    ) {
      return {
        processingError:
          'Payment identifiers, amount, currency, or provider references mismatch.',
        status: WebhookEventStatus.FAILED,
      };
    }

    if (payment.status !== targetStatus) {
      try {
        assertPaymentTransition(payment.status, targetStatus);
      } catch (error: unknown) {
        if (error instanceof InvalidPaymentTransitionError) {
          return {
            processingError:
              'The event would regress or skip the local payment state machine.',
            status: WebhookEventStatus.IGNORED,
          };
        }

        throw error;
      }
    }

    if (
      targetStatus === PaymentStatus.SUCCEEDED &&
      !this.canRepresentSuccessfulOrder(payment.order.status)
    ) {
      return {
        processingError: 'The order cannot represent a successful payment.',
        status: WebhookEventStatus.FAILED,
      };
    }

    if (payment.status !== targetStatus) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId:
            payment.providerPaymentId ?? action.providerPaymentId,
          status: targetStatus,
        },
      });
    } else if (!payment.providerPaymentId && action.providerPaymentId) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: action.providerPaymentId },
      });
    }

    if (
      targetStatus === PaymentStatus.SUCCEEDED &&
      payment.order.status === OrderStatus.PENDING_PAYMENT
    ) {
      assertOrderTransition(payment.order.status, OrderStatus.PAID);
      await transaction.order.update({
        where: { id: payment.order.id },
        data: { status: OrderStatus.PAID },
      });
    }

    return {
      processingError: null,
      status: WebhookEventStatus.PROCESSED,
    };
  }

  private canRepresentSuccessfulOrder(status: OrderStatus): boolean {
    if (status === OrderStatus.PENDING_PAYMENT) {
      try {
        assertOrderTransition(status, OrderStatus.PAID);
        return true;
      } catch (error: unknown) {
        if (error instanceof InvalidOrderTransitionError) {
          return false;
        }

        throw error;
      }
    }

    return new Set<OrderStatus>([
      OrderStatus.PAID,
      OrderStatus.FULFILLED,
      OrderStatus.PARTIALLY_REFUNDED,
      OrderStatus.REFUNDED,
    ]).has(status);
  }

  private databaseProvider(provider: string): PaymentProvider {
    if (provider === PaymentProvider.STRIPE) {
      return PaymentProvider.STRIPE;
    }

    throw new Error(`Unsupported persisted payment provider: ${provider}.`);
  }

  private localPaymentStatus(
    status: ProviderPaymentStatus,
  ):
    | typeof PaymentStatus.PROCESSING
    | typeof PaymentStatus.SUCCEEDED
    | typeof PaymentStatus.FAILED {
    switch (status) {
      case ProviderPaymentStatus.PROCESSING:
        return PaymentStatus.PROCESSING;
      case ProviderPaymentStatus.SUCCEEDED:
        return PaymentStatus.SUCCEEDED;
      case ProviderPaymentStatus.FAILED:
        return PaymentStatus.FAILED;
      case ProviderPaymentStatus.PENDING:
        throw new Error('A pending provider event cannot transition payment.');
    }
  }

  private localRefundStatus(status: ProviderRefundStatus): RefundStatus {
    switch (status) {
      case ProviderRefundStatus.PENDING:
        return RefundStatus.PENDING;
      case ProviderRefundStatus.SUCCEEDED:
        return RefundStatus.SUCCEEDED;
      case ProviderRefundStatus.FAILED:
        return RefundStatus.FAILED;
    }
  }
}
