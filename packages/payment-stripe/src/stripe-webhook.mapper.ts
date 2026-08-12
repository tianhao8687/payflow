import {
  type ProviderPaymentTransitionAction,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type ProviderWebhookAction,
} from '@payflow/payment-core';
import Stripe from 'stripe';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mapStripeWebhookEvent(
  event: Stripe.Event,
): ProviderWebhookAction {
  if (event.livemode) {
    return {
      kind: 'REJECT',
      reason: 'Stripe live-mode events are forbidden in PayFlow.',
    };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;

      if (session.payment_status === 'paid') {
        return fromCheckoutSession(session, ProviderPaymentStatus.SUCCEEDED);
      }

      if (session.payment_status === 'unpaid') {
        return fromCheckoutSession(session, ProviderPaymentStatus.PROCESSING);
      }

      return {
        kind: 'IGNORE',
        reason: `Checkout payment status ${session.payment_status} is not payable by this integration.`,
      };
    }
    case 'checkout.session.async_payment_succeeded':
      return fromCheckoutSession(
        event.data.object,
        ProviderPaymentStatus.SUCCEEDED,
      );
    case 'checkout.session.async_payment_failed':
      return fromCheckoutSession(
        event.data.object,
        ProviderPaymentStatus.FAILED,
      );
    case 'payment_intent.processing':
      return fromPaymentIntent(
        event.data.object,
        ProviderPaymentStatus.PROCESSING,
      );
    case 'payment_intent.succeeded':
      return fromPaymentIntent(
        event.data.object,
        ProviderPaymentStatus.SUCCEEDED,
      );
    case 'payment_intent.payment_failed':
      return fromPaymentIntent(event.data.object, ProviderPaymentStatus.FAILED);
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
      return fromRefund(
        event.data.object,
        event.request?.id ?? null,
        event.type === 'refund.failed',
      );
    case 'charge.refunded':
      return {
        kind: 'IGNORE',
        reason:
          'Current Stripe guidance uses refund.created/updated/failed for refund detail; charge.refunded is audit-only.',
      };
    default:
      return {
        kind: 'IGNORE',
        reason: `Event type ${event.type} is not handled by PayFlow.`,
      };
  }
}

function fromRefund(
  refund: Stripe.Refund,
  providerRequestId: string | null,
  forcedFailure: boolean,
): ProviderWebhookAction {
  const identifiers = readRefundIdentifiers(refund.metadata);

  if (!identifiers) {
    return missingMetadata(refund.id);
  }

  const status = forcedFailure
    ? ProviderRefundStatus.FAILED
    : mapRefundStatus(refund.status);

  if (!status) {
    return {
      kind: 'REJECT',
      reason: `Stripe refund ${refund.id} has unsupported status ${refund.status ?? 'null'}.`,
    };
  }

  return {
    amount: refund.amount,
    currency: refund.currency.toUpperCase(),
    failureCode:
      status === ProviderRefundStatus.FAILED
        ? (refund.failure_reason ?? refund.status ?? 'failed')
        : null,
    failureMessage:
      status === ProviderRefundStatus.FAILED
        ? 'Stripe reported that the refund failed or was canceled.'
        : null,
    kind: 'REFUND_SYNC',
    ...identifiers,
    providerPaymentId: expandableId(refund.payment_intent),
    providerRefundId: refund.id,
    providerRequestId,
    status,
  };
}

function fromCheckoutSession(
  session: Stripe.Checkout.Session,
  targetStatus: ProviderPaymentTransitionAction['targetStatus'],
): ProviderWebhookAction {
  const identifiers = readIdentifiers(session.metadata);

  if (!identifiers) {
    return missingMetadata(session.id);
  }

  return {
    amount: session.amount_total,
    currency: normalizeCurrency(session.currency),
    kind: 'PAYMENT_TRANSITION',
    ...identifiers,
    providerCheckoutSessionId: session.id,
    providerPaymentId: expandableId(session.payment_intent),
    targetStatus,
  };
}

function fromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  targetStatus: ProviderPaymentTransitionAction['targetStatus'],
): ProviderWebhookAction {
  const identifiers = readIdentifiers(paymentIntent.metadata);

  if (!identifiers) {
    return missingMetadata(paymentIntent.id);
  }

  return {
    amount: paymentIntent.amount,
    currency: normalizeCurrency(paymentIntent.currency),
    kind: 'PAYMENT_TRANSITION',
    ...identifiers,
    providerCheckoutSessionId: null,
    providerPaymentId: paymentIntent.id,
    targetStatus,
  };
}

function readIdentifiers(
  metadata: Stripe.Metadata | null,
): { orderId: string; paymentId: string } | null {
  const orderId = metadata?.orderId;
  const paymentId = metadata?.paymentId;

  if (
    typeof orderId !== 'string' ||
    typeof paymentId !== 'string' ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(paymentId)
  ) {
    return null;
  }

  return { orderId, paymentId };
}

function readRefundIdentifiers(metadata: Stripe.Metadata | null): {
  orderId: string;
  paymentId: string;
  refundId: string;
} | null {
  const orderId = metadata?.orderId;
  const paymentId = metadata?.paymentId;
  const refundId = metadata?.refundId;

  if (
    typeof orderId !== 'string' ||
    typeof paymentId !== 'string' ||
    typeof refundId !== 'string' ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(paymentId) ||
    !uuidPattern.test(refundId)
  ) {
    return null;
  }

  return { orderId, paymentId, refundId };
}

function mapRefundStatus(status: string | null): ProviderRefundStatus | null {
  if (status === 'succeeded') {
    return ProviderRefundStatus.SUCCEEDED;
  }

  if (status === 'failed' || status === 'canceled') {
    return ProviderRefundStatus.FAILED;
  }

  if (status === 'pending' || status === 'requires_action') {
    return ProviderRefundStatus.PENDING;
  }

  return null;
}

function expandableId(value: string | { id: string } | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}

function normalizeCurrency(currency: string | null): string | null {
  return currency?.toUpperCase() ?? null;
}

function missingMetadata(objectId: string): ProviderWebhookAction {
  return {
    kind: 'IGNORE',
    reason: `Stripe object ${objectId} has no valid PayFlow metadata.`,
  };
}
