import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { ApiEnvironment } from '../config/environment';

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super('Stripe webhook signature verification failed.');
    this.name = 'StripeWebhookSignatureError';
  }
}

@Injectable()
export class StripeWebhookVerifier {
  private readonly endpointSecret: string;
  private readonly stripe: Stripe;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    const secretKey = config.get('STRIPE_SECRET_KEY', { infer: true });
    this.endpointSecret = config.get('STRIPE_WEBHOOK_SECRET', {
      infer: true,
    });
    this.stripe = new Stripe(
      secretKey || 'sk_test_payflow_webhook_verification_only',
      {
        appInfo: { name: 'PayFlow', version: '0.4.0' },
        telemetry: false,
      },
    );
  }

  isConfigured(): boolean {
    return this.endpointSecret.length > 0;
  }

  verify(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.endpointSecret,
      );
    } catch {
      throw new StripeWebhookSignatureError();
    }
  }
}
