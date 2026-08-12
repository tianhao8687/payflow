import { PaymentStatus } from '@payflow/database';
import Stripe from 'stripe';

interface StripeWebhookIgnoredAction {
  kind: 'IGNORE';
  reason: string;
}

interface StripeWebhookRejectedAction {
  kind: 'REJECT';
  reason: string;
}

export interface StripePaymentTransitionAction {
  amount: number | null;
  currency: string | null;
  kind: 'PAYMENT_TRANSITION';
  orderId: string;
  paymentId: string;
  providerCheckoutSessionId: string | null;
  providerPaymentId: string | null;
  targetStatus:
    | typeof PaymentStatus.PROCESSING
    | typeof PaymentStatus.SUCCEEDED
    | typeof PaymentStatus.FAILED;
}

export type StripeWebhookAction =
  | StripeWebhookIgnoredAction
  | StripeWebhookRejectedAction
  | StripePaymentTransitionAction;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mapStripeWebhookEvent(
  event: Stripe.Event,
): StripeWebhookAction {
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
        return fromCheckoutSession(session, PaymentStatus.SUCCEEDED);
      }

      if (session.payment_status === 'unpaid') {
        return fromCheckoutSession(session, PaymentStatus.PROCESSING);
      }

      return {
        kind: 'IGNORE',
        reason: `Checkout payment status ${session.payment_status} is not payable by this integration.`,
      };
    }
    case 'checkout.session.async_payment_succeeded':
      return fromCheckoutSession(event.data.object, PaymentStatus.SUCCEEDED);
    case 'checkout.session.async_payment_failed':
      return fromCheckoutSession(event.data.object, PaymentStatus.FAILED);
    case 'payment_intent.processing':
      return fromPaymentIntent(event.data.object, PaymentStatus.PROCESSING);
    case 'payment_intent.succeeded':
      return fromPaymentIntent(event.data.object, PaymentStatus.SUCCEEDED);
    case 'payment_intent.payment_failed':
      return fromPaymentIntent(event.data.object, PaymentStatus.FAILED);
    default:
      return {
        kind: 'IGNORE',
        reason: `Event type ${event.type} is not handled by Stage 4.`,
      };
  }
}

function fromCheckoutSession(
  session: Stripe.Checkout.Session,
  targetStatus: StripePaymentTransitionAction['targetStatus'],
): StripeWebhookAction {
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
  targetStatus: StripePaymentTransitionAction['targetStatus'],
): StripeWebhookAction {
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

function expandableId(value: string | { id: string } | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}

function normalizeCurrency(currency: string | null): string | null {
  return currency?.toUpperCase() ?? null;
}

function missingMetadata(objectId: string): StripeWebhookIgnoredAction {
  return {
    kind: 'IGNORE',
    reason: `Stripe object ${objectId} has no valid PayFlow metadata.`,
  };
}
