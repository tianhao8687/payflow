import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { ApiEnvironment } from '../config/environment';

export interface StripeCheckoutLine {
  name: string;
  quantity: number;
  sku: string;
  unitAmount: number;
}

export interface CreateStripeCheckoutInput {
  amount: number;
  cancelUrl: string;
  currency: string;
  idempotencyKey: string;
  lines: StripeCheckoutLine[];
  orderId: string;
  paymentId: string;
  successUrl: string;
}

export interface StripeCheckoutResult {
  amountTotal: number;
  currency: string;
  expiresAt: Date;
  paymentIntentId: string | null;
  requestId: string | null;
  sessionId: string;
  url: string;
}

export class StripeCheckoutGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'StripeCheckoutGatewayError';
  }
}

@Injectable()
export class StripeCheckoutGateway {
  private readonly stripe: Stripe | null;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    const secretKey = config.get('STRIPE_SECRET_KEY', { infer: true });

    this.stripe = secretKey
      ? new Stripe(secretKey, {
          appInfo: { name: 'PayFlow', version: '0.3.0' },
          maxNetworkRetries: 2,
          telemetry: false,
          timeout: 20_000,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  async createCheckoutSession(
    input: CreateStripeCheckoutInput,
  ): Promise<StripeCheckoutResult> {
    if (!this.stripe) {
      throw new StripeCheckoutGatewayError(
        'STRIPE_NOT_CONFIGURED',
        'Stripe test mode is not configured.',
      );
    }

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
          ui_mode: 'hosted',
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (!session.url || session.amount_total === null || !session.currency) {
        throw new StripeCheckoutGatewayError(
          'STRIPE_SESSION_INCOMPLETE',
          'Stripe returned an incomplete hosted Checkout Session.',
          session.lastResponse?.requestId ?? null,
        );
      }

      return {
        amountTotal: session.amount_total,
        currency: session.currency.toUpperCase(),
        expiresAt: new Date(session.expires_at * 1000),
        paymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        requestId: session.lastResponse?.requestId ?? null,
        sessionId: session.id,
        url: session.url,
      };
    } catch (error: unknown) {
      if (error instanceof StripeCheckoutGatewayError) {
        throw error;
      }

      if (error instanceof Stripe.errors.StripeError) {
        throw new StripeCheckoutGatewayError(
          error.code ?? error.type,
          error.message,
          error.requestId ?? null,
        );
      }

      throw new StripeCheckoutGatewayError(
        'STRIPE_REQUEST_FAILED',
        'Stripe Checkout request failed before a verified response arrived.',
      );
    }
  }
}
