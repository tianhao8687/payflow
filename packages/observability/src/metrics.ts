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
  'inbox_received_total',
  'inbox_dispatch_lag_seconds',
  'inbox_dispatch_failure_total',
  'inbox_dispatch_retry_delay_seconds',
  'inbox_oldest_event_age_seconds',
  'webhook_event_conflict_total',
] as const;

interface Instruments {
  inboxDispatchFailure: Counter;
  inboxDispatchLag: Histogram;
  inboxDispatchRetry: Histogram;
  inboxOldestEventAge: Histogram;
  inboxReceived: Counter;
  paymentFailed: Counter;
  paymentSuccess: Counter;
  reconciliationIssue: Counter;
  refundFailed: Counter;
  webhookDuplicate: Counter;
  webhookEventConflict: Counter;
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

export function recordWebhookEventConflict(attributes: Attributes = {}): void {
  instruments().webhookEventConflict.add(1, attributes);
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

export function recordInboxReceived(attributes: Attributes = {}): void {
  instruments().inboxReceived.add(1, attributes);
}

export function recordInboxDispatchLag(
  seconds: number,
  attributes: Attributes = {},
): void {
  instruments().inboxDispatchLag.record(seconds, attributes);
}

export function recordInboxDispatchFailure(attributes: Attributes = {}): void {
  instruments().inboxDispatchFailure.add(1, attributes);
}

export function recordInboxDispatchRetry(
  seconds: number,
  attributes: Attributes = {},
): void {
  instruments().inboxDispatchRetry.record(seconds, attributes);
}

export function recordInboxOldestEventAge(
  seconds: number,
  attributes: Attributes = {},
): void {
  instruments().inboxOldestEventAge.record(seconds, attributes);
}

function instruments(): Instruments {
  if (registered) {
    return registered;
  }
  const meter = metrics.getMeter('@payflow/observability', '0.1.0');
  registered = {
    inboxReceived: meter.createCounter('inbox_received_total', {
      description: 'Authenticated provider events durably stored in the inbox.',
    }),
    inboxDispatchLag: meter.createHistogram('inbox_dispatch_lag_seconds', {
      description: 'Delay between inbox persistence and queue dispatch.',
      unit: 's',
    }),
    inboxDispatchFailure: meter.createCounter('inbox_dispatch_failure_total', {
      description: 'Failed attempts to dispatch durable inbox events.',
    }),
    inboxDispatchRetry: meter.createHistogram(
      'inbox_dispatch_retry_delay_seconds',
      {
        description: 'Persisted delay before an inbox dispatch retry is due.',
        unit: 's',
      },
    ),
    inboxOldestEventAge: meter.createHistogram(
      'inbox_oldest_event_age_seconds',
      {
        description: 'Observed age of the oldest pending inbox event.',
        unit: 's',
      },
    ),
    paymentSuccess: meter.createCounter('payment_success_total', {
      description: 'Payments that transition to successful local state.',
    }),
    paymentFailed: meter.createCounter('payment_failed_total', {
      description: 'Payments that transition to failed local state.',
    }),
    webhookDuplicate: meter.createCounter('webhook_duplicate_total', {
      description: 'Authenticated duplicate provider webhook deliveries.',
    }),
    webhookEventConflict: meter.createCounter('webhook_event_conflict_total', {
      description:
        'Authenticated provider event IDs reused with different normalized content.',
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
