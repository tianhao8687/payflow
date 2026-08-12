import { PaymentStatus } from '@payflow/database';
import Stripe from 'stripe';

import { mapStripeWebhookEvent } from './stripe-webhook-event';

const orderId = '22222222-2222-4222-8222-222222222222';
const paymentId = '11111111-1111-4111-8111-111111111111';

describe('mapStripeWebhookEvent', () => {
  it('maps a paid Checkout Session to a successful local payment', () => {
    const action = mapStripeWebhookEvent(
      event('checkout.session.completed', {
        amount_total: 2999,
        currency: 'usd',
        id: 'cs_test_payflow',
        metadata: { orderId, paymentId },
        object: 'checkout.session',
        payment_intent: 'pi_test_payflow',
        payment_status: 'paid',
      }),
    );

    expect(action).toEqual({
      amount: 2999,
      currency: 'USD',
      kind: 'PAYMENT_TRANSITION',
      orderId,
      paymentId,
      providerCheckoutSessionId: 'cs_test_payflow',
      providerPaymentId: 'pi_test_payflow',
      targetStatus: PaymentStatus.SUCCEEDED,
    });
  });

  it('keeps an unpaid completed Checkout Session in processing', () => {
    const action = mapStripeWebhookEvent(
      event('checkout.session.completed', {
        amount_total: 2999,
        currency: 'usd',
        id: 'cs_test_payflow',
        metadata: { orderId, paymentId },
        object: 'checkout.session',
        payment_intent: 'pi_test_payflow',
        payment_status: 'unpaid',
      }),
    );

    expect(action).toMatchObject({
      kind: 'PAYMENT_TRANSITION',
      targetStatus: PaymentStatus.PROCESSING,
    });
  });

  it('maps a failed PaymentIntent without trusting browser state', () => {
    const action = mapStripeWebhookEvent(
      event('payment_intent.payment_failed', {
        amount: 2999,
        currency: 'usd',
        id: 'pi_test_payflow',
        metadata: { orderId, paymentId },
        object: 'payment_intent',
      }),
    );

    expect(action).toMatchObject({
      kind: 'PAYMENT_TRANSITION',
      providerPaymentId: 'pi_test_payflow',
      targetStatus: PaymentStatus.FAILED,
    });
  });

  it('ignores unknown events and recognized events without PayFlow metadata', () => {
    expect(
      mapStripeWebhookEvent(
        event('customer.created', { id: 'cus_test', object: 'customer' }),
      ),
    ).toMatchObject({ kind: 'IGNORE' });
    expect(
      mapStripeWebhookEvent(
        event('payment_intent.succeeded', {
          amount: 2999,
          currency: 'usd',
          id: 'pi_without_metadata',
          metadata: {},
          object: 'payment_intent',
        }),
      ),
    ).toMatchObject({ kind: 'IGNORE' });
  });

  it('rejects live-mode events in this sandbox-only project', () => {
    expect(
      mapStripeWebhookEvent(
        event(
          'payment_intent.succeeded',
          {
            amount: 2999,
            currency: 'usd',
            id: 'pi_live_forbidden',
            metadata: { orderId, paymentId },
            object: 'payment_intent',
          },
          true,
        ),
      ),
    ).toMatchObject({ kind: 'REJECT' });
  });
});

function event(
  type: Stripe.Event.Type,
  object: Record<string, unknown>,
  livemode = false,
): Stripe.Event {
  return {
    api_version: '2026-07-29.dahlia',
    created: 1_786_560_000,
    data: { object },
    id: `evt_${type.replaceAll('.', '_')}`,
    livemode,
    object: 'event',
    pending_webhooks: 1,
    request: null,
    type,
  } as unknown as Stripe.Event;
}
