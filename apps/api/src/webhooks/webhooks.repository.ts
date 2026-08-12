import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  WebhookEventStatus,
} from '@payflow/database';
import Stripe from 'stripe';

import { DatabaseService } from '../database/database.service';
import {
  InvalidOrderTransitionError,
  assertOrderTransition,
} from '../orders/order-state-machine';
import {
  InvalidPaymentTransitionError,
  assertPaymentTransition,
} from '../payments/payment-state-machine';
import type {
  StripePaymentTransitionAction,
  StripeWebhookAction,
} from './stripe-webhook-event';

export interface WebhookProcessingResult {
  duplicate: boolean;
  status: WebhookEventStatus;
}

@Injectable()
export class WebhooksRepository {
  constructor(private readonly database: DatabaseService) {}

  async processStripeEvent(
    event: Stripe.Event,
    action: StripeWebhookAction,
  ): Promise<WebhookProcessingResult> {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            await transaction.$queryRaw(
              Prisma.sql`SELECT 1::integer AS acquired
                FROM pg_advisory_xact_lock(hashtextextended(${event.id}, 0))`,
            );

            const existing = await transaction.webhookEvent.findUnique({
              where: { providerEventId: event.id },
              select: { status: true },
            });

            if (existing) {
              return { duplicate: true, status: existing.status };
            }

            const webhookEvent = await transaction.webhookEvent.create({
              data: {
                eventType: event.type,
                payloadJson: JSON.parse(
                  JSON.stringify(event),
                ) as Prisma.InputJsonValue,
                provider: PaymentProvider.STRIPE,
                providerEventId: event.id,
              },
              select: { id: true },
            });

            let status: WebhookEventStatus;

            if (action.kind === 'IGNORE') {
              status = WebhookEventStatus.IGNORED;
            } else if (action.kind === 'REJECT') {
              status = WebhookEventStatus.FAILED;
            } else {
              status = await this.processPaymentTransition(transaction, action);
            }

            await transaction.webhookEvent.update({
              where: { id: webhookEvent.id },
              data: { processedAt: new Date(), status },
            });

            return { duplicate: false, status };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
    action: StripePaymentTransitionAction,
  ): Promise<WebhookEventStatus> {
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
      payment.provider !== PaymentProvider.STRIPE ||
      payment.orderId !== action.orderId ||
      action.amount !== payment.amount ||
      action.currency !== payment.currency ||
      (action.providerCheckoutSessionId !== null &&
        action.providerCheckoutSessionId !==
          payment.providerCheckoutSessionId) ||
      (payment.providerPaymentId !== null &&
        action.providerPaymentId !== null &&
        payment.providerPaymentId !== action.providerPaymentId) ||
      (action.targetStatus === PaymentStatus.SUCCEEDED &&
        action.providerPaymentId === null)
    ) {
      return WebhookEventStatus.FAILED;
    }

    if (payment.status !== action.targetStatus) {
      try {
        assertPaymentTransition(payment.status, action.targetStatus);
      } catch (error: unknown) {
        if (error instanceof InvalidPaymentTransitionError) {
          return WebhookEventStatus.IGNORED;
        }

        throw error;
      }
    }

    if (
      action.targetStatus === PaymentStatus.SUCCEEDED &&
      !this.canRepresentSuccessfulOrder(payment.order.status)
    ) {
      return WebhookEventStatus.FAILED;
    }

    if (payment.status !== action.targetStatus) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId:
            payment.providerPaymentId ?? action.providerPaymentId,
          status: action.targetStatus,
        },
      });
    } else if (!payment.providerPaymentId && action.providerPaymentId) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: action.providerPaymentId },
      });
    }

    if (
      action.targetStatus === PaymentStatus.SUCCEEDED &&
      payment.order.status === OrderStatus.PENDING_PAYMENT
    ) {
      assertOrderTransition(payment.order.status, OrderStatus.PAID);
      await transaction.order.update({
        where: { id: payment.order.id },
        data: { status: OrderStatus.PAID },
      });
    }

    return WebhookEventStatus.PROCESSED;
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
}
