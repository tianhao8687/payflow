import {
  PaymentProviderError,
  ProviderRefundStatus,
} from '@payflow/payment-core';

import { StripeProvider } from './stripe.provider';

describe('StripeProvider refund adapter', () => {
  it('sends immutable identifiers and a stable idempotency key', async () => {
    const provider = createProvider();
    const create = jest.fn().mockResolvedValue({
      amount: 1200,
      currency: 'usd',
      failure_reason: null,
      id: 're_test_unit',
      lastResponse: { requestId: 'req_refund_unit' },
      payment_intent: 'pi_test_unit',
      status: 'succeeded',
    });
    Reflect.set(provider, 'stripe', { refunds: { create } });

    await expect(
      provider.refundPayment({
        amount: 1200,
        currency: 'USD',
        idempotencyKey:
          'refund:create:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444',
        orderId: '22222222-2222-4222-8222-222222222222',
        paymentId: '11111111-1111-4111-8111-111111111111',
        providerPaymentId: 'pi_test_unit',
        refundId: '33333333-3333-4333-8333-333333333333',
        refundRequestId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toEqual({
      amount: 1200,
      currency: 'USD',
      failureCode: null,
      failureMessage: null,
      providerPaymentId: 'pi_test_unit',
      providerRefundId: 're_test_unit',
      providerRequestId: 'req_refund_unit',
      status: ProviderRefundStatus.SUCCEEDED,
    });

    expect(create).toHaveBeenCalledWith(
      {
        amount: 1200,
        metadata: {
          orderId: '22222222-2222-4222-8222-222222222222',
          paymentId: '11111111-1111-4111-8111-111111111111',
          refundId: '33333333-3333-4333-8333-333333333333',
          refundRequestId: '44444444-4444-4444-8444-444444444444',
        },
        payment_intent: 'pi_test_unit',
      },
      {
        idempotencyKey:
          'refund:create:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444',
      },
    );
  });

  it('preserves pending outcomes and fails closed on unknown status', async () => {
    const provider = createProvider();
    const create = jest
      .fn()
      .mockResolvedValueOnce(refund('pending', 're_pending', 'req_pending'))
      .mockResolvedValueOnce(refund('mystery', 're_unknown', 'req_unknown'));
    Reflect.set(provider, 'stripe', { refunds: { create } });
    const input = {
      amount: 1200,
      currency: 'USD',
      idempotencyKey: 'refund:create:payment:request',
      orderId: 'order-id',
      paymentId: 'payment-id',
      providerPaymentId: 'pi_test_unit',
      refundId: 'refund-id',
      refundRequestId: 'request-id',
    };

    await expect(provider.refundPayment(input)).resolves.toMatchObject({
      status: ProviderRefundStatus.PENDING,
    });
    await expect(provider.refundPayment(input)).rejects.toMatchObject<
      Partial<PaymentProviderError>
    >({
      code: 'STRIPE_REFUND_STATUS_UNKNOWN',
      outcomeUnknown: true,
      provider: 'STRIPE',
    });
  });
});

function createProvider(): StripeProvider {
  return new StripeProvider({
    secretKey: 'sk_test_unit_only',
    webhookSecret: 'whsec_stage_7_unit',
  });
}

function refund(status: string, id: string, requestId: string) {
  return {
    amount: 1200,
    currency: 'usd',
    failure_reason: null,
    id,
    lastResponse: { requestId },
    payment_intent: 'pi_test_unit',
    status,
  };
}
