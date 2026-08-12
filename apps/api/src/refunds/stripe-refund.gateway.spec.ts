import { ConfigService } from '@nestjs/config';
import { RefundStatus } from '@payflow/database';

import type { ApiEnvironment } from '../config/environment';
import {
  StripeRefundGateway,
  StripeRefundGatewayError,
} from './stripe-refund.gateway';

describe('StripeRefundGateway', () => {
  it('sends immutable identifiers and a stable idempotency key to Stripe', async () => {
    const gateway = createGateway();
    const create = jest.fn().mockResolvedValue({
      amount: 1200,
      currency: 'usd',
      failure_reason: null,
      id: 're_test_unit',
      lastResponse: { requestId: 'req_refund_unit' },
      payment_intent: 'pi_test_unit',
      status: 'succeeded',
    });
    Reflect.set(gateway, 'stripe', { refunds: { create } });

    await expect(
      gateway.createRefund({
        amount: 1200,
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
      requestId: 'req_refund_unit',
      status: RefundStatus.SUCCEEDED,
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

  it('preserves pending provider outcomes and fails closed on unknown status', async () => {
    const gateway = createGateway();
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        amount: 1200,
        currency: 'usd',
        failure_reason: null,
        id: 're_pending',
        lastResponse: { requestId: 'req_pending' },
        payment_intent: 'pi_test_unit',
        status: 'pending',
      })
      .mockResolvedValueOnce({
        amount: 1200,
        currency: 'usd',
        failure_reason: null,
        id: 're_unknown',
        lastResponse: { requestId: 'req_unknown' },
        payment_intent: 'pi_test_unit',
        status: 'mystery',
      });
    Reflect.set(gateway, 'stripe', { refunds: { create } });
    const input = {
      amount: 1200,
      idempotencyKey: 'refund:create:payment:request',
      orderId: 'order-id',
      paymentId: 'payment-id',
      providerPaymentId: 'pi_test_unit',
      refundId: 'refund-id',
      refundRequestId: 'request-id',
    };

    await expect(gateway.createRefund(input)).resolves.toMatchObject({
      status: RefundStatus.PENDING,
    });
    await expect(gateway.createRefund(input)).rejects.toMatchObject<
      Partial<StripeRefundGatewayError>
    >({
      code: 'STRIPE_REFUND_STATUS_UNKNOWN',
      outcomeUnknown: true,
    });
  });
});

function createGateway(): StripeRefundGateway {
  const config = {
    get: jest.fn().mockReturnValue('sk_test_unit_only'),
  } as unknown as ConfigService<ApiEnvironment, true>;

  return new StripeRefundGateway(config);
}
