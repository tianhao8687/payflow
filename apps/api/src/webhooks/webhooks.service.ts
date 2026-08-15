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
import {
  enrichCorrelation,
  setActiveSpanAttributes,
  SpanKind,
  withSpan,
} from '@payflow/observability';

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
    return this.handle('STRIPE', rawBody, {
      headers: { 'stripe-signature': signature },
    });
  }

  handlePayPal(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<WebhookResponseDto> {
    return this.handle('PAYPAL', rawBody, {
      headers: { ...headers, 'paypal-transmission-sig': signature },
    });
  }

  async handleAlipay(
    rawBody: Buffer | undefined,
    contentType: string | undefined,
    parsedForm: Readonly<Record<string, string>> | undefined,
  ): Promise<WebhookResponseDto> {
    return this.handle('ALIPAY', rawBody, { contentType, parsedForm });
  }

  private async handle(
    providerName: string,
    rawBody: Buffer | undefined,
    input: {
      contentType?: string;
      headers?: Readonly<Record<string, string | undefined>>;
      parsedForm?: Readonly<Record<string, string>>;
    },
  ): Promise<WebhookResponseDto> {
    const provider = this.providerFor(providerName);
    enrichCorrelation({ provider: providerName });
    setActiveSpanAttributes({ 'payment.provider': providerName });
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
    if (rawBody.byteLength > 32 * 1024) {
      throw new BadRequestException({
        code: 'WEBHOOK_BODY_TOO_LARGE',
        message: 'Webhook body exceeds the 32 KiB limit.',
      });
    }

    try {
      const event = await withSpan(
        'provider.webhook.verify',
        {
          attributes: { 'payment.provider': providerName },
          kind: SpanKind.CLIENT,
        },
        () => provider.verifyWebhook({ ...input, rawBody }),
      );
      const correlation = correlationFromAction(event.action);
      enrichCorrelation({
        ...correlation,
        provider: event.provider,
        providerEventId: event.providerEventId,
      });
      setActiveSpanAttributes({
        'payment.provider': event.provider,
        'payment.provider_event_id': event.providerEventId,
        ...(correlation.orderId
          ? { 'payflow.order.id': correlation.orderId }
          : {}),
        ...(correlation.paymentId
          ? { 'payflow.payment.id': correlation.paymentId }
          : {}),
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
        new Set(['WEBHOOK_SIGNATURE_INVALID', 'ALIPAY_WEBHOOK_INVALID']).has(
          error.code,
        )
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

function correlationFromAction(action: {
  kind: string;
  orderId?: string | null;
  paymentId?: string | null;
  refundId?: string;
}) {
  return {
    ...(action.orderId ? { orderId: action.orderId } : {}),
    ...(action.paymentId ? { paymentId: action.paymentId } : {}),
    ...(action.refundId ? { refundId: action.refundId } : {}),
  };
}
