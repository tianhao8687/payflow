import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '../config/environment';
import { StripeCheckoutGateway } from './stripe-checkout.gateway';

describe('StripeCheckoutGateway', () => {
  it('uses the current hosted_page API value and stable request idempotency', async () => {
    const config = {
      get: jest.fn().mockReturnValue('sk_test_unit_only'),
    } as unknown as ConfigService<ApiEnvironment, true>;
    const gateway = new StripeCheckoutGateway(config);
    const create = jest.fn().mockResolvedValue({
      amount_total: 2400,
      currency: 'usd',
      expires_at: 1_786_637_123,
      id: 'cs_test_unit',
      lastResponse: { requestId: 'req_unit' },
      payment_intent: null,
      url: 'https://checkout.stripe.com/c/pay/cs_test_unit',
    });
    Reflect.set(gateway, 'stripe', {
      checkout: { sessions: { create } },
    });

    await expect(
      gateway.createCheckoutSession({
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
      amountTotal: 2400,
      currency: 'USD',
      requestId: 'req_unit',
      sessionId: 'cs_test_unit',
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
});
