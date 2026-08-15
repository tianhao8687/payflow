import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentProvider, WebhookEventStatus } from '@payflow/database';
import { type VerifiedWebhookEvent } from '@payflow/payment-core';
import {
  type WebhookReceipt,
  WebhookEventConflictError,
  WebhookEventStore,
} from '@payflow/payment-domain';
import {
  recordInboxReceived,
  recordWebhookDuplicate,
  recordWebhookEventConflict,
} from '@payflow/observability';

import { DatabaseService } from '../database/database.service';

export interface WebhookProcessingResult {
  duplicate: boolean;
  queued: boolean;
  status: WebhookEventStatus;
}

@Injectable()
export class WebhooksRepository {
  private readonly store: WebhookEventStore;

  constructor(private readonly database: DatabaseService) {
    this.store = new WebhookEventStore(database.prisma);
  }

  async processProviderEvent(
    event: VerifiedWebhookEvent,
  ): Promise<WebhookProcessingResult> {
    await this.preflightAlipay(event);
    let receipt: WebhookReceipt;
    try {
      receipt = await this.store.receive(event);
    } catch (error: unknown) {
      if (error instanceof WebhookEventConflictError) {
        recordWebhookEventConflict({ provider: event.provider });
        throw new BadRequestException({
          code: error.code,
          details: {
            provider: error.provider,
            providerEventId: error.providerEventId,
          },
          message:
            'The provider event ID was already stored with different verified content.',
        });
      }
      throw error;
    }
    recordInboxReceived({ provider: event.provider });
    if (receipt.duplicate) {
      recordWebhookDuplicate({ provider: event.provider });
    }
    return {
      duplicate: receipt.duplicate,
      queued: receipt.enqueue || receipt.status === WebhookEventStatus.RECEIVED,
      status: receipt.status,
    };
  }

  private async preflightAlipay(event: VerifiedWebhookEvent): Promise<void> {
    if (event.provider !== PaymentProvider.ALIPAY) {
      return;
    }
    const assertion = event.paymentAssertion;
    const payment = assertion
      ? await this.database.prisma.payment.findFirst({
          where: {
            id: assertion.merchantReference,
            provider: PaymentProvider.ALIPAY,
          },
          select: { amount: true, currency: true },
        })
      : null;
    if (
      !assertion ||
      !payment ||
      assertion.amount !== payment.amount ||
      assertion.currency !== payment.currency
    ) {
      throw new BadRequestException({
        code: 'ALIPAY_WEBHOOK_REFERENCE_MISMATCH',
        message:
          'Alipay merchant reference, amount, or currency does not match the local payment.',
      });
    }
  }
}
