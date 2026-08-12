import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WebhookEventStatus } from '@payflow/database';
import {
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  PaymentProviderRegistry,
} from '@payflow/payment-core';

import { WebhookResponseDto } from './dto/webhook-response.dto';
import { WebhooksRepository } from './webhooks.repository';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly providers: PaymentProviderRegistry | PaymentProvider,
    private readonly webhooksRepository: WebhooksRepository,
  ) {}

  handleStripe(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResponseDto> {
    return this.handle('STRIPE', rawBody, signature, {});
  }

  handlePayPal(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<WebhookResponseDto> {
    return this.handle('PAYPAL', rawBody, signature, headers);
  }

  private async handle(
    providerName: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<WebhookResponseDto> {
    const provider = this.providerFor(providerName);
    if (
      !provider ||
      !provider.isConfigured(PaymentProviderCapability.WEBHOOK)
    ) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_PROVIDER_NOT_CONFIGURED',
        details: { provider: providerName },
        message: `${providerName} webhook verification is not configured.`,
      });
    }

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException({
        code: 'WEBHOOK_RAW_BODY_REQUIRED',
        message: 'The unmodified request body is required.',
      });
    }
    if (!signature) {
      throw this.invalidSignature(providerName);
    }

    try {
      const event = await provider.verifyWebhook({
        headers,
        rawBody,
        signature,
      });
      const result = await this.webhooksRepository.processProviderEvent(event);

      if (result.status === WebhookEventStatus.FAILED) {
        throw new BadRequestException({
          code: 'WEBHOOK_EVENT_REJECTED',
          message: `The signed ${providerName} event failed local integrity checks.`,
        });
      }

      return { received: true, ...result };
    } catch (error: unknown) {
      if (
        error instanceof PaymentProviderError &&
        error.code === 'WEBHOOK_SIGNATURE_INVALID'
      ) {
        throw this.invalidSignature(providerName);
      }
      throw error;
    }
  }

  private providerFor(name: string): PaymentProvider | undefined {
    if (this.providers instanceof PaymentProviderRegistry) {
      return this.providers.get(name);
    }
    return this.providers.name === name ? this.providers : undefined;
  }

  private invalidSignature(provider: string): BadRequestException {
    return new BadRequestException({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      details: { provider },
      message: `${provider} webhook signature verification failed.`,
    });
  }
}
