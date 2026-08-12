import { PaymentProviderError } from '@payflow/payment-core';

import { PayPalProvider } from './paypal.provider';
import {
  mapPayPalWebhookEvent,
  minorToPayPalValue,
  paypalValueToMinor,
} from './paypal-webhook.mapper';

describe('PayPalProvider webhook verification', () => {
  it('posts the exact raw event into official verification and maps approval', async () => {
    const bodies: string[] = [];
    const responses = [
      response({ access_token: 'token', expires_in: 3_600 }),
      response({ verification_status: 'SUCCESS' }),
    ];
    const provider = new PayPalProvider({
      clientId: 'client',
      clientSecret: 'secret',
      fetch: jest.fn((_input, init) => {
        bodies.push(typeof init?.body === 'string' ? init.body : '');
        return Promise.resolve(responses.shift() as Response);
      }) as typeof fetch,
      webhookId: 'WH-123',
    });
    const event = {
      create_time: '2026-08-13T01:02:03.000Z',
      event_type: 'CHECKOUT.ORDER.APPROVED',
      id: 'WH-EVENT-1',
      resource: {
        id: 'PAYPAL-ORDER-1',
        purchase_units: [
          {
            custom_id: '11111111-1111-4111-8111-111111111111',
            invoice_id: '22222222-2222-4222-8222-222222222222',
          },
        ],
      },
    };
    const raw = JSON.stringify(event, null, 2);

    await expect(
      provider.verifyWebhook({
        headers: {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.paypal.com/certs/CERT-1',
          'paypal-transmission-id': 'transmission-1',
          'paypal-transmission-time': '2026-08-13T01:02:04Z',
        },
        rawBody: Buffer.from(raw),
        signature: 'signature-1',
      }),
    ).resolves.toMatchObject({
      action: {
        kind: 'CAPTURE_PAYMENT',
        orderId: '22222222-2222-4222-8222-222222222222',
        paymentId: '11111111-1111-4111-8111-111111111111',
        providerCheckoutSessionId: 'PAYPAL-ORDER-1',
      },
      eventType: 'CHECKOUT.ORDER.APPROVED',
      provider: 'PAYPAL',
      providerEventId: 'WH-EVENT-1',
    });

    expect(bodies[1]).toContain(`"webhook_event":${raw}}`);
  });

  it('fails closed when PayPal does not confirm the signature', async () => {
    const responses = [
      response({ access_token: 'token', expires_in: 3_600 }),
      response({ verification_status: 'FAILURE' }),
    ];
    const provider = new PayPalProvider({
      clientId: 'client',
      clientSecret: 'secret',
      fetch: jest.fn(() =>
        Promise.resolve(responses.shift() as Response),
      ) as typeof fetch,
      webhookId: 'WH-123',
    });

    await expect(
      provider.verifyWebhook({
        headers: {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.paypal.com/certs/CERT-1',
          'paypal-transmission-id': 'transmission-1',
          'paypal-transmission-time': '2026-08-13T01:02:04Z',
        },
        rawBody: Buffer.from('{"id":"WH-EVENT-1","event_type":"TEST"}'),
        signature: 'invalid',
      }),
    ).rejects.toMatchObject<Partial<PaymentProviderError>>({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
  });
});

describe('PayPal webhook normalization and exact money', () => {
  it('maps capture and refund notifications without floating point', () => {
    expect(minorToPayPalValue(3_998, 'USD')).toBe('39.98');
    expect(paypalValueToMinor('39.98', 'USD')).toBe(3_998);
    expect(minorToPayPalValue(500, 'JPY')).toBe('500');

    expect(
      mapPayPalWebhookEvent({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          amount: { currency_code: 'USD', value: '39.98' },
          custom_id: '11111111-1111-4111-8111-111111111111',
          id: 'CAPTURE-1',
          invoice_id: '22222222-2222-4222-8222-222222222222',
          supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
        },
      }),
    ).toMatchObject({
      amount: 3_998,
      kind: 'PAYMENT_TRANSITION',
      providerPaymentId: 'CAPTURE-1',
      targetStatus: 'SUCCEEDED',
    });

    expect(
      mapPayPalWebhookEvent({
        event_type: 'PAYMENT.REFUND.PENDING',
        resource: {
          amount: { currency_code: 'USD', value: '12.00' },
          custom_id: '33333333-3333-4333-8333-333333333333',
          id: 'REFUND-1',
          supplementary_data: { related_ids: { capture_id: 'CAPTURE-1' } },
        },
      }),
    ).toMatchObject({
      amount: 1_200,
      kind: 'REFUND_SYNC',
      providerPaymentId: 'CAPTURE-1',
      refundId: '33333333-3333-4333-8333-333333333333',
      status: 'PENDING',
    });
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}
