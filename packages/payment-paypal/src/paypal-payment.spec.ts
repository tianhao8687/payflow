import {
  PaymentProviderCapability,
  ProviderPaymentStatus,
  ProviderRefundStatus,
} from '@payflow/payment-core';

import { PayPalProvider } from './paypal.provider';

describe('PayPalProvider payments and refunds', () => {
  it('creates, captures, and refunds through the unified provider contract', async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const responses = [
      json({ access_token: 'sandbox-token', expires_in: 3_600 }),
      json(
        {
          id: '5O190127TN364715T',
          links: [
            {
              href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
              rel: 'payer-action',
            },
          ],
          purchase_units: [
            { amount: { currency_code: 'USD', value: '39.98' } },
          ],
          status: 'PAYER_ACTION_REQUIRED',
        },
        201,
        { 'paypal-debug-id': 'debug-create' },
      ),
      json(
        {
          id: '5O190127TN364715T',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    amount: { currency_code: 'USD', value: '39.98' },
                    id: '3C679366HH908993F',
                    status: 'COMPLETED',
                  },
                ],
              },
            },
          ],
          status: 'COMPLETED',
        },
        201,
        { 'paypal-debug-id': 'debug-capture' },
      ),
      json(
        {
          amount: { currency_code: 'USD', value: '12.00' },
          id: '1JU08902781691411',
          status: 'COMPLETED',
        },
        201,
        { 'paypal-debug-id': 'debug-refund' },
      ),
    ];
    const provider = providerWithResponses(responses, requests);

    expect(provider.isConfigured(PaymentProviderCapability.PAYMENT)).toBe(true);
    await expect(
      provider.createPayment({
        amount: 3_998,
        cancelUrl: 'http://localhost:3000/orders/order-id?checkout=cancelled',
        currency: 'USD',
        idempotencyKey: 'payment:create:paypal:order-id:1',
        lines: [
          {
            name: 'Snapshot Product',
            quantity: 2,
            sku: 'PF-1',
            unitAmount: 1_999,
          },
        ],
        orderId: '22222222-2222-4222-8222-222222222222',
        paymentId: '11111111-1111-4111-8111-111111111111',
        successUrl: 'http://localhost:3000/payments/payment-id/result',
      }),
    ).resolves.toMatchObject({
      amount: 3_998,
      currency: 'USD',
      providerCheckoutSessionId: '5O190127TN364715T',
      providerPaymentId: null,
      providerRequestId: 'debug-create',
      status: ProviderPaymentStatus.PENDING,
    });

    await expect(
      provider.capturePayment({
        idempotencyKey: 'payment:capture:11111111-1111-4111-8111-111111111111',
        providerPaymentId: '5O190127TN364715T',
      }),
    ).resolves.toMatchObject({
      amount: 3_998,
      providerPaymentId: '3C679366HH908993F',
      status: ProviderPaymentStatus.SUCCEEDED,
    });

    await expect(
      provider.refundPayment({
        amount: 1_200,
        currency: 'USD',
        idempotencyKey: 'refund:create:payment-id:request-id',
        orderId: '22222222-2222-4222-8222-222222222222',
        paymentId: '11111111-1111-4111-8111-111111111111',
        providerPaymentId: '3C679366HH908993F',
        refundId: '33333333-3333-4333-8333-333333333333',
        refundRequestId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toMatchObject({
      amount: 1_200,
      providerRefundId: '1JU08902781691411',
      status: ProviderRefundStatus.SUCCEEDED,
    });

    expect(requests).toHaveLength(4);
    expect(requests[1]?.init?.headers).toMatchObject({
      'PayPal-Request-Id': 'payment:create:paypal:order-id:1',
    });
    expect(JSON.parse(requestBody(requests[1]?.init))).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: 'USD', value: '39.98' },
          custom_id: '11111111-1111-4111-8111-111111111111',
          invoice_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });
    expect(JSON.parse(requestBody(requests[3]?.init))).toMatchObject({
      amount: { currency_code: 'USD', value: '12.00' },
      custom_id: '33333333-3333-4333-8333-333333333333',
    });
  });
});

function providerWithResponses(
  responses: Response[],
  requests: Array<{ init?: RequestInit; url: string }>,
): PayPalProvider {
  const fetcher = jest.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ init, url: requestUrl(input) });
      const response = responses.shift();
      if (!response) {
        return Promise.reject(new Error('Unexpected PayPal request.'));
      }
      return Promise.resolve(response);
    },
  ) as typeof fetch;

  return new PayPalProvider({
    clientId: 'sandbox-client-id',
    clientSecret: 'sandbox-client-secret',
    fetch: fetcher,
    now: () => Date.parse('2026-08-13T00:00:00.000Z'),
    webhookId: 'sandbox-webhook-id',
  });
}

function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
    status,
  });
}
