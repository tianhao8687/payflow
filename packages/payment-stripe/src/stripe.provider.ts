import {
  type CancelPaymentInput,
  type CancelPaymentResult,
  type CapturePaymentInput,
  type CapturePaymentResult,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  type PaymentProviderOperation,
  type ProviderPayment,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type RefundPaymentInput,
  type RefundPaymentResult,
  type VerifiedWebhookEvent,
  type VerifyWebhookInput,
} from '@payflow/payment-core';
import Stripe from 'stripe';

import { mapStripeWebhookEvent } from './stripe-webhook.mapper';

export interface StripeProviderOptions {
  appName?: string;
  appVersion?: string;
  maxNetworkRetries?: number;
  secretKey: string;
  timeoutMs?: number;
  webhookSecret: string;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'STRIPE';
  private readonly paymentConfigured: boolean;
  private stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(options: StripeProviderOptions) {
    this.paymentConfigured = options.secretKey.length > 0;
    this.webhookSecret = options.webhookSecret;
    this.stripe = new Stripe(
      options.secretKey || 'sk_test_payflow_webhook_verification_only',
      {
        appInfo: {
          name: options.appName ?? 'PayFlow',
          version: options.appVersion ?? '0.7.0',
        },
        maxNetworkRetries: options.maxNetworkRetries ?? 2,
        telemetry: false,
        timeout: options.timeoutMs ?? 20_000,
      },
    );
  }

  isConfigured(capability: PaymentProviderCapability): boolean {
    return capability === PaymentProviderCapability.WEBHOOK
      ? this.webhookSecret.length > 0
      : this.paymentConfigured;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'CREATE_PAYMENT');

    try {
      const session = await this.stripe.checkout.sessions.create(
        {
          cancel_url: input.cancelUrl,
          client_reference_id: input.orderId,
          line_items: input.lines.map((line) => ({
            price_data: {
              currency: input.currency.toLowerCase(),
              product_data: {
                metadata: { sku: line.sku },
                name: line.name,
              },
              unit_amount: line.unitAmount,
            },
            quantity: line.quantity,
          })),
          metadata: {
            orderId: input.orderId,
            paymentId: input.paymentId,
          },
          mode: 'payment',
          payment_intent_data: {
            metadata: {
              orderId: input.orderId,
              paymentId: input.paymentId,
            },
          },
          success_url: input.successUrl,
          ui_mode: 'hosted_page',
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (!session.url || session.amount_total === null || !session.currency) {
        throw new PaymentProviderError(
          this.name,
          'CREATE_PAYMENT',
          'STRIPE_SESSION_INCOMPLETE',
          'Stripe returned an incomplete hosted Checkout Session.',
          session.lastResponse?.requestId ?? null,
        );
      }

      return {
        amount: session.amount_total,
        currency: session.currency.toUpperCase(),
        expiresAt: new Date(session.expires_at * 1000),
        providerCheckoutSessionId: session.id,
        providerPaymentId: expandableId(session.payment_intent),
        providerRequestId: session.lastResponse?.requestId ?? null,
        redirectUrl: session.url,
        status: ProviderPaymentStatus.PENDING,
      };
    } catch (error: unknown) {
      this.throwProviderError(
        error,
        'CREATE_PAYMENT',
        'STRIPE_REQUEST_FAILED',
        'Stripe Checkout failed before a verified response arrived.',
        true,
      );
    }
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'GET_PAYMENT');

    try {
      const paymentIntent =
        await this.stripe.paymentIntents.retrieve(providerPaymentId);
      return this.toProviderPayment(paymentIntent);
    } catch (error: unknown) {
      this.throwProviderError(
        error,
        'GET_PAYMENT',
        'STRIPE_PAYMENT_LOOKUP_FAILED',
        'Stripe PaymentIntent lookup failed.',
        false,
      );
    }
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentResult> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'CAPTURE_PAYMENT');

    try {
      const paymentIntent = await this.stripe.paymentIntents.capture(
        input.providerPaymentId,
        {},
        { idempotencyKey: input.idempotencyKey },
      );
      return this.toProviderPayment(paymentIntent);
    } catch (error: unknown) {
      this.throwProviderError(
        error,
        'CAPTURE_PAYMENT',
        'STRIPE_PAYMENT_CAPTURE_FAILED',
        'Stripe PaymentIntent capture failed.',
        true,
      );
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentResult> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'CANCEL_PAYMENT');

    try {
      const paymentIntent = await this.stripe.paymentIntents.cancel(
        input.providerPaymentId,
        {},
        { idempotencyKey: input.idempotencyKey },
      );
      return this.toProviderPayment(paymentIntent);
    } catch (error: unknown) {
      this.throwProviderError(
        error,
        'CANCEL_PAYMENT',
        'STRIPE_PAYMENT_CANCEL_FAILED',
        'Stripe PaymentIntent cancellation failed.',
        true,
      );
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.assertConfigured(PaymentProviderCapability.REFUND, 'REFUND_PAYMENT');

    try {
      const refund = await this.stripe.refunds.create(
        {
          amount: input.amount,
          metadata: {
            orderId: input.orderId,
            paymentId: input.paymentId,
            refundId: input.refundId,
            refundRequestId: input.refundRequestId,
          },
          payment_intent: input.providerPaymentId,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      const status = this.mapRefundStatus(refund.status);

      return {
        amount: refund.amount,
        currency: refund.currency.toUpperCase(),
        failureCode:
          status === ProviderRefundStatus.FAILED
            ? (refund.failure_reason ?? refund.status ?? 'failed')
            : null,
        failureMessage:
          status === ProviderRefundStatus.FAILED
            ? 'Stripe reported that the refund failed or was canceled.'
            : null,
        providerPaymentId: expandableId(refund.payment_intent),
        providerRefundId: refund.id,
        providerRequestId: refund.lastResponse?.requestId ?? null,
        status,
      };
    } catch (error: unknown) {
      this.throwProviderError(
        error,
        'REFUND_PAYMENT',
        'STRIPE_REFUND_REQUEST_FAILED',
        'Stripe Refund failed before a verified response arrived.',
        true,
      );
    }
  }

  async verifyWebhook(
    input: VerifyWebhookInput,
  ): Promise<VerifiedWebhookEvent> {
    this.assertConfigured(PaymentProviderCapability.WEBHOOK, 'VERIFY_WEBHOOK');

    let event: Stripe.Event;

    try {
      event = await this.stripe.webhooks.constructEventAsync(
        Buffer.from(input.rawBody),
        input.signature,
        this.webhookSecret,
      );
    } catch (error: unknown) {
      if (error instanceof PaymentProviderError) {
        throw error;
      }

      throw new PaymentProviderError(
        this.name,
        'VERIFY_WEBHOOK',
        'WEBHOOK_SIGNATURE_INVALID',
        'Stripe webhook signature verification failed.',
      );
    }

    return {
      action: mapStripeWebhookEvent(event),
      eventType: event.type,
      occurredAt: new Date(event.created * 1000),
      payload: JSON.parse(JSON.stringify(event)) as unknown,
      provider: this.name,
      providerEventId: event.id,
    };
  }

  private assertConfigured(
    capability: PaymentProviderCapability,
    operation: PaymentProviderOperation,
  ): void {
    if (!this.isConfigured(capability)) {
      throw new PaymentProviderError(
        this.name,
        operation,
        'PROVIDER_NOT_CONFIGURED',
        `Stripe ${capability.toLowerCase()} configuration is missing.`,
      );
    }
  }

  private mapPaymentStatus(
    status: Stripe.PaymentIntent.Status,
  ): ProviderPaymentStatus {
    switch (status) {
      case 'succeeded':
        return ProviderPaymentStatus.SUCCEEDED;
      case 'processing':
      case 'requires_capture':
        return ProviderPaymentStatus.PROCESSING;
      case 'canceled':
        return ProviderPaymentStatus.FAILED;
      case 'requires_action':
      case 'requires_confirmation':
      case 'requires_payment_method':
        return ProviderPaymentStatus.PENDING;
    }
  }

  private mapRefundStatus(status: string | null): ProviderRefundStatus {
    if (status === 'succeeded') {
      return ProviderRefundStatus.SUCCEEDED;
    }

    if (status === 'failed' || status === 'canceled') {
      return ProviderRefundStatus.FAILED;
    }

    if (status === 'pending' || status === 'requires_action') {
      return ProviderRefundStatus.PENDING;
    }

    throw new PaymentProviderError(
      this.name,
      'REFUND_PAYMENT',
      'STRIPE_REFUND_STATUS_UNKNOWN',
      'Stripe returned an unsupported refund status.',
      null,
      true,
    );
  }

  private toProviderPayment(
    paymentIntent: Stripe.Response<Stripe.PaymentIntent>,
  ): ProviderPayment {
    return {
      amount: paymentIntent.amount,
      currency: paymentIntent.currency.toUpperCase(),
      providerPaymentId: paymentIntent.id,
      providerRequestId: paymentIntent.lastResponse?.requestId ?? null,
      status: this.mapPaymentStatus(paymentIntent.status),
    };
  }

  private throwProviderError(
    error: unknown,
    operation: PaymentProviderOperation,
    fallbackCode: string,
    fallbackMessage: string,
    mutation: boolean,
  ): never {
    if (error instanceof PaymentProviderError) {
      throw error;
    }

    if (error instanceof Stripe.errors.StripeError) {
      throw new PaymentProviderError(
        this.name,
        operation,
        error.code ?? error.type,
        error.message,
        error.requestId ?? null,
        mutation && this.isOutcomeUnknown(error.type),
      );
    }

    throw new PaymentProviderError(
      this.name,
      operation,
      fallbackCode,
      fallbackMessage,
      null,
      mutation,
    );
  }

  private isOutcomeUnknown(type: string): boolean {
    return new Set([
      'StripeAPIError',
      'StripeConnectionError',
      'StripeIdempotencyError',
      'StripeRateLimitError',
    ]).has(type);
  }
}

function expandableId(value: string | { id: string } | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}
