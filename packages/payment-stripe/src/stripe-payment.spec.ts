import {
  PaymentProviderCapability,
  ProviderPaymentStatus,
} from '@payflow/payment-core';

import { StripeProvider } from './stripe.provider';

describe('StripeProvider payment adapter', () => {
  it('uses hosted Checkout and the stable provider idempotency key', async () => {
    const provider = createProvider();
    const create = jest.fn().mockResolvedValue({
      amount_total: 2400,
      currency: 'usd',
      expires_at: 1_786_637_123,
      id: 'cs_test_unit',
      lastResponse: { requestId: 'req_unit' },
      payment_intent: null,
      url: 'https://checkout.stripe.com/c/pay/cs_test_unit',
    });
    Reflect.set(provider, 'stripe', {
      checkout: { sessions: { create } },
    });

    await expect(
      provider.createPayment({
        amount: 2400,
        cancelUrl: 'http://localhost:3000/orders/order-id?checkout=cancelled',
        currency: 'USD',
        idempotencyKey: 'payment:create:order-id:1',
        lines: [
          {
            name: 'State Machine Cards',
            quantity: 1,
            sku: 'PF-CARD-003',
            unitAmount: 2400,
          },
        ],
        orderId: 'order-id',
        paymentId: 'payment-id',
        successUrl:
          'http://localhost:3000/payments/payment-id/result?session_id={CHECKOUT_SESSION_ID}',
      }),
    ).resolves.toMatchObject({
      amount: 2400,
      currency: 'USD',
      providerCheckoutSessionId: 'cs_test_unit',
      providerRequestId: 'req_unit',
      status: ProviderPaymentStatus.PENDING,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: 'order-id',
        metadata: { orderId: 'order-id', paymentId: 'payment-id' },
        payment_intent_data: {
          metadata: { orderId: 'order-id', paymentId: 'payment-id' },
        },
        ui_mode: 'hosted_page',
      }),
      { idempotencyKey: 'payment:create:order-id:1' },
    );
  });

  it('normalizes lookup, capture, and cancellation statuses', async () => {
    const provider = createProvider();
    const retrieve = jest
      .fn()
      .mockResolvedValue(paymentIntent('processing', 'req_lookup'));
    const capture = jest
      .fn()
      .mockResolvedValue(paymentIntent('succeeded', 'req_capture'));
    const cancel = jest
      .fn()
      .mockResolvedValue(paymentIntent('canceled', 'req_cancel'));
    Reflect.set(provider, 'stripe', {
      paymentIntents: { cancel, capture, retrieve },
    });

    await expect(provider.getPayment('pi_test_unit')).resolves.toMatchObject({
      status: ProviderPaymentStatus.PROCESSING,
    });
    await expect(
      provider.capturePayment({
        idempotencyKey: 'payment:capture:local-id',
        providerPaymentId: 'pi_test_unit',
      }),
    ).resolves.toMatchObject({ status: ProviderPaymentStatus.SUCCEEDED });
    await expect(
      provider.cancelPayment({
        idempotencyKey: 'payment:cancel:local-id',
        providerPaymentId: 'pi_test_unit',
      }),
    ).resolves.toMatchObject({ status: ProviderPaymentStatus.FAILED });

    expect(capture).toHaveBeenCalledWith(
      'pi_test_unit',
      {},
      { idempotencyKey: 'payment:capture:local-id' },
    );
    expect(cancel).toHaveBeenCalledWith(
      'pi_test_unit',
      {},
      { idempotencyKey: 'payment:cancel:local-id' },
    );
  });

  it('reports configuration per adapter capability', () => {
    const provider = new StripeProvider({
      secretKey: '',
      webhookSecret: 'whsec_stage_7_unit',
    });

    expect(provider.isConfigured(PaymentProviderCapability.PAYMENT)).toBe(
      false,
    );
    expect(provider.isConfigured(PaymentProviderCapability.REFUND)).toBe(false);
    expect(provider.isConfigured(PaymentProviderCapability.WEBHOOK)).toBe(true);
  });
});

function createProvider(): StripeProvider {
  return new StripeProvider({
    secretKey: 'sk_test_unit_only',
    webhookSecret: 'whsec_stage_7_unit',
  });
}

function paymentIntent(status: string, requestId: string) {
  return {
    amount: 2400,
    currency: 'usd',
    id: 'pi_test_unit',
    lastResponse: { requestId },
    status,
  };
}
