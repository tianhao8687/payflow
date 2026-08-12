import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { ApiEnvironment } from '../config/environment';
import {
  StripeWebhookSignatureError,
  StripeWebhookVerifier,
} from './stripe-webhook.verifier';

describe('StripeWebhookVerifier', () => {
  const endpointSecret = 'whsec_stage_4_unit_test';
  const payload = JSON.stringify({
    id: 'evt_signature_test',
    object: 'event',
    type: 'customer.created',
  });

  it('accepts the exact signed bytes and rejects mutated bytes', () => {
    const verifier = new StripeWebhookVerifier(config(endpointSecret));
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: endpointSecret,
    });

    expect(verifier.verify(Buffer.from(payload), signature).id).toBe(
      'evt_signature_test',
    );
    expect(() =>
      verifier.verify(Buffer.from(`${payload} `), signature),
    ).toThrow(StripeWebhookSignatureError);
  });

  it('reports whether the signing secret is configured', () => {
    expect(new StripeWebhookVerifier(config('')).isConfigured()).toBe(false);
    expect(
      new StripeWebhookVerifier(config(endpointSecret)).isConfigured(),
    ).toBe(true);
  });
});

function config(endpointSecret: string): ConfigService<ApiEnvironment, true> {
  return {
    get: jest.fn((key: keyof ApiEnvironment) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        return endpointSecret;
      }

      if (key === 'STRIPE_SECRET_KEY') {
        return '';
      }

      throw new Error(`Unexpected config key ${key}.`);
    }),
  } as unknown as ConfigService<ApiEnvironment, true>;
}
