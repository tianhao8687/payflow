import { PaymentProviderError } from '@payflow/payment-core';
import Stripe from 'stripe';

import { StripeProvider } from './stripe.provider';

describe('StripeProvider webhook verification', () => {
  const webhookSecret = 'whsec_stage_7_unit_test';
  const payload = JSON.stringify({
    api_version: '2026-07-29.dahlia',
    created: 1_786_560_000,
    data: { object: { id: 'cus_test', object: 'customer' } },
    id: 'evt_signature_test',
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: null,
    type: 'customer.created',
  });

  it('accepts exact signed bytes and rejects mutated bytes', async () => {
    const provider = createProvider(webhookSecret);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    await expect(
      provider.verifyWebhook({
        rawBody: Buffer.from(payload),
        signature,
      }),
    ).resolves.toMatchObject({
      action: { kind: 'IGNORE' },
      provider: 'STRIPE',
      providerEventId: 'evt_signature_test',
    });
    await expect(
      provider.verifyWebhook({
        rawBody: Buffer.from(`${payload} `),
        signature,
      }),
    ).rejects.toMatchObject<Partial<PaymentProviderError>>({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      operation: 'VERIFY_WEBHOOK',
    });
  });

  it('fails closed when the endpoint signing secret is absent', async () => {
    const provider = createProvider('');

    await expect(
      provider.verifyWebhook({
        rawBody: Buffer.from(payload),
        signature: 't=1,v1=not-used',
      }),
    ).rejects.toMatchObject<Partial<PaymentProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
      operation: 'VERIFY_WEBHOOK',
    });
  });
});

function createProvider(webhookSecret: string): StripeProvider {
  return new StripeProvider({ secretKey: '', webhookSecret });
}
