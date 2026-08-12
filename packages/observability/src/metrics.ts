import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
} from '@opentelemetry/api';

export const PAYFLOW_METRIC_NAMES = [
  'payment_success_total',
  'payment_failed_total',
  'webhook_duplicate_total',
  'webhook_processing_seconds',
  'refund_failed_total',
  'reconciliation_issue_total',
] as const;

interface Instruments {
  paymentFailed: Counter;
  paymentSuccess: Counter;
  reconciliationIssue: Counter;
  refundFailed: Counter;
  webhookDuplicate: Counter;
  webhookProcessing: Histogram;
}

let registered: Instruments | null = null;

export function recordPaymentSuccess(attributes: Attributes = {}): void {
  instruments().paymentSuccess.add(1, attributes);
}

export function recordPaymentFailure(attributes: Attributes = {}): void {
  instruments().paymentFailed.add(1, attributes);
}

export function recordWebhookDuplicate(attributes: Attributes = {}): void {
  instruments().webhookDuplicate.add(1, attributes);
}

export function recordWebhookProcessing(
  seconds: number,
  attributes: Attributes = {},
): void {
  instruments().webhookProcessing.record(seconds, attributes);
}

export function recordRefundFailure(attributes: Attributes = {}): void {
  instruments().refundFailed.add(1, attributes);
}

export function recordReconciliationIssue(attributes: Attributes = {}): void {
  instruments().reconciliationIssue.add(1, attributes);
}

function instruments(): Instruments {
  if (registered) {
    return registered;
  }
  const meter = metrics.getMeter('@payflow/observability', '0.1.0');
  registered = {
    paymentSuccess: meter.createCounter('payment_success_total', {
      description: 'Payments that transition to successful local state.',
    }),
    paymentFailed: meter.createCounter('payment_failed_total', {
      description: 'Payments that transition to failed local state.',
    }),
    webhookDuplicate: meter.createCounter('webhook_duplicate_total', {
      description: 'Authenticated duplicate provider webhook deliveries.',
    }),
    webhookProcessing: meter.createHistogram('webhook_processing_seconds', {
      description: 'Webhook worker processing duration.',
      unit: 's',
    }),
    refundFailed: meter.createCounter('refund_failed_total', {
      description: 'Refunds that transition to failed local state.',
    }),
    reconciliationIssue: meter.createCounter('reconciliation_issue_total', {
      description: 'New provider reconciliation issues detected.',
    }),
  };
  return registered;
}
