import {
  ProviderPaymentStatus,
  ProviderRefundStatus,
} from '@payflow/payment-core';
import Stripe from 'stripe';

import { mapStripeWebhookEvent } from './stripe-webhook.mapper';

const orderId = '22222222-2222-4222-8222-222222222222';
const paymentId = '11111111-1111-4111-8111-111111111111';
const refundId = '33333333-3333-4333-8333-333333333333';

describe('mapStripeWebhookEvent', () => {
  it('maps a paid Checkout Session to a normalized success', () => {
    expect(
      mapStripeWebhookEvent(
        event('checkout.session.completed', {
          amount_total: 2999,
          currency: 'usd',
          id: 'cs_test_payflow',
          metadata: { orderId, paymentId },
          object: 'checkout.session',
          payment_intent: 'pi_test_payflow',
          payment_status: 'paid',
        }),
      ),
    ).toEqual({
      amount: 2999,
      currency: 'USD',
      kind: 'PAYMENT_TRANSITION',
      merchantReference: paymentId,
      orderId,
      paymentId,
      providerCheckoutSessionId: 'cs_test_payflow',
      providerPaymentId: 'pi_test_payflow',
      targetStatus: ProviderPaymentStatus.SUCCEEDED,
    });
  });

  it('normalizes unpaid and failed provider states', () => {
    expect(
      mapStripeWebhookEvent(
        event('checkout.session.completed', {
          amount_total: 2999,
          currency: 'usd',
          id: 'cs_test_payflow',
          metadata: { orderId, paymentId },
          object: 'checkout.session',
          payment_intent: 'pi_test_payflow',
          payment_status: 'unpaid',
        }),
      ),
    ).toMatchObject({
      kind: 'PAYMENT_TRANSITION',
      targetStatus: ProviderPaymentStatus.PROCESSING,
    });
    expect(
      mapStripeWebhookEvent(
        event('payment_intent.payment_failed', {
          amount: 2999,
          currency: 'usd',
          id: 'pi_test_payflow',
          metadata: { orderId, paymentId },
          object: 'payment_intent',
        }),
      ),
    ).toMatchObject({
      kind: 'PAYMENT_TRANSITION',
      targetStatus: ProviderPaymentStatus.FAILED,
    });
  });

  it('maps current Refund events to a normalized refund snapshot', () => {
    expect(
      mapStripeWebhookEvent(
        event(
          'refund.updated',
          {
            amount: 1200,
            currency: 'usd',
            failure_reason: null,
            id: 're_test_payflow',
            metadata: { orderId, paymentId, refundId },
            object: 'refund',
            payment_intent: 'pi_test_payflow',
            status: 'succeeded',
          },
          false,
          { id: 'req_refund_webhook', idempotency_key: null },
        ),
      ),
    ).toEqual({
      amount: 1200,
      currency: 'USD',
      failureCode: null,
      failureMessage: null,
      kind: 'REFUND_SYNC',
      orderId,
      paymentId,
      providerPaymentId: 'pi_test_payflow',
      providerRefundId: 're_test_payflow',
      providerRequestId: 'req_refund_webhook',
      refundId,
      status: ProviderRefundStatus.SUCCEEDED,
    });
  });

  it('keeps charge.refunded audit-only and ignores unknown events', () => {
    expect(
      mapStripeWebhookEvent(
        event('charge.refunded', { id: 'ch_test', object: 'charge' }),
      ),
    ).toMatchObject({ kind: 'IGNORE' });
    expect(
      mapStripeWebhookEvent(
        event('customer.created', { id: 'cus_test', object: 'customer' }),
      ),
    ).toMatchObject({ kind: 'IGNORE' });
  });

  it('ignores missing metadata and rejects live-mode events', () => {
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
  request: Stripe.Event.Request | null = null,
): Stripe.Event {
  return {
    api_version: '2026-07-29.dahlia',
    created: 1_786_560_000,
    data: { object },
    id: `evt_${type.replaceAll('.', '_')}`,
    livemode,
    object: 'event',
    pending_webhooks: 1,
    request,
    type,
  } as unknown as Stripe.Event;
}
