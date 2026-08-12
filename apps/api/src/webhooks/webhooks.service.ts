import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WebhookEventStatus } from '@payflow/database';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
} from '@payflow/payment-core';

import { WebhookResponseDto } from './dto/webhook-response.dto';
import { WebhooksRepository } from './webhooks.repository';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly webhooksRepository: WebhooksRepository,
  ) {}

  async handleStripe(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResponseDto> {
    if (!this.paymentProvider.isConfigured(PaymentProviderCapability.WEBHOOK)) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_PROVIDER_NOT_CONFIGURED',
        message: 'Stripe webhook verification is not configured.',
      });
    }

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException({
        code: 'WEBHOOK_RAW_BODY_REQUIRED',
        message: 'The unmodified request body is required.',
      });
    }

    if (!signature) {
      throw this.invalidSignature();
    }

    try {
      const event = await this.paymentProvider.verifyWebhook({
        rawBody,
        signature,
      });
      const result = await this.webhooksRepository.processProviderEvent(event);

      if (result.status === WebhookEventStatus.FAILED) {
        throw new BadRequestException({
          code: 'WEBHOOK_EVENT_REJECTED',
          message: 'The signed Stripe event failed local integrity checks.',
        });
      }

      return { received: true, ...result };
    } catch (error: unknown) {
      if (
        error instanceof PaymentProviderError &&
        error.code === 'WEBHOOK_SIGNATURE_INVALID'
      ) {
        throw this.invalidSignature();
      }

      throw error;
    }
  }

  private invalidSignature(): BadRequestException {
    return new BadRequestException({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      message: 'Stripe webhook signature verification failed.',
    });
  }
}
