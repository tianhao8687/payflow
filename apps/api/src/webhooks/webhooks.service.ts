import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WebhookEventStatus } from '@payflow/database';

import { WebhookResponseDto } from './dto/webhook-response.dto';
import { mapStripeWebhookEvent } from './stripe-webhook-event';
import {
  StripeWebhookSignatureError,
  StripeWebhookVerifier,
} from './stripe-webhook.verifier';
import { WebhooksRepository } from './webhooks.repository';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly verifier: StripeWebhookVerifier,
    private readonly webhooksRepository: WebhooksRepository,
  ) {}

  async handleStripe(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResponseDto> {
    if (!this.verifier.isConfigured()) {
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
      const event = this.verifier.verify(rawBody, signature);
      const result = await this.webhooksRepository.processStripeEvent(
        event,
        mapStripeWebhookEvent(event),
      );

      if (result.status === WebhookEventStatus.FAILED) {
        throw new BadRequestException({
          code: 'WEBHOOK_EVENT_REJECTED',
          message: 'The signed Stripe event failed local integrity checks.',
        });
      }

      return { received: true, ...result };
    } catch (error: unknown) {
      if (error instanceof StripeWebhookSignatureError) {
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
