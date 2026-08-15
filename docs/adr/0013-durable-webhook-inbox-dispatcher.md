# ADR 0013: Acknowledge provider events from the durable inbox

- Status: Accepted for Stage 11 implementation
- Date: 2026-08-15
- Supersedes: the acknowledgement/enqueue coupling in ADR 0010

## Context

ADR 0010 inserted a verified provider event and then synchronously enqueued its
BullMQ job before returning `2xx`. PostgreSQL already held the durable event, but
a Redis outage still forced Stripe or PayPal to retry and would make Alipay
withhold its exact `success` acknowledgement. This coupled provider delivery to
an ephemeral transport and created unnecessary replay load.

## Decision

- The webhook request verifies provider-specific signature and identity data,
  normalizes the action, and inserts/deduplicates a `RECEIVED` WebhookEvent in a
  PostgreSQL transaction.
- After that transaction commits, the API acknowledges the provider. For Alipay
  the response is exactly plain-text `success`; Stripe and PayPal retain their
  compatible JSON response.
- The API does not contact Redis on this path. A Worker-side Inbox Dispatcher
  scans only `RECEIVED` rows where `queued_at IS NULL`, claims each row with a
  bounded database lease, and enqueues the WebhookEvent UUID as deterministic
  BullMQ job ID.
- Queue failure leaves the event `RECEIVED`, records a bounded safe error and a
  later lease, and is retried by the Dispatcher. `queued_at` prevents a Worker
  processing retry from being dispatched as a second job.
- Metrics cover received events, dispatch failures, persistence-to-queue lag,
  and the observed age of the oldest pending Inbox event.

## Consequences

- A provider `2xx`/Alipay `success` now means “authenticated and durably
  received,” not “already present in Redis” and not “business state changed.”
- Redis can be unavailable during receipt without losing an authenticated
  event. Queue lag becomes an internal recovery and alerting concern.
- PostgreSQL capacity and availability are on the acknowledgement path and must
  be monitored accordingly.
- Existing Stripe/PayPal clients retain the response shape, but the `queued`
  compatibility field means accepted for asynchronous dispatch rather than a
  confirmed Redis write.
- Browser redirects remain untrusted. Only the later locked Worker projection
  changes Payment, Refund, Order, outbox, or ledger state.
