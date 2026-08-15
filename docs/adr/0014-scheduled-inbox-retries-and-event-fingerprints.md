# ADR 0014: Schedule Inbox retries and bind event identity to content

- Status: Accepted
- Date: 2026-08-15
- Extends: ADR 0013

## Context

ADR 0013 made PostgreSQL the durable acknowledgement boundary, but its first
Dispatcher used one fixed five-second delay after every Redis failure. During a
long outage, the oldest failed rows could repeatedly occupy the batch and create
a synchronized retry storm. The Inbox uniqueness key also treated every later
`(provider, provider_event_id)` delivery as equivalent without proving that its
verified content matched the first delivery.

The implementation was compared with mature open-source payment systems:

- [Hyperswitch Process Tracker](https://github.com/juspay/hyperswitch/blob/main/crates/scheduler/src/db/process_tracker.rs)
  persists `retry_count` and `schedule_time`; its
  [outgoing webhook workflow](https://github.com/juspay/hyperswitch/blob/main/crates/router/src/workflows/outgoing_webhook_retry.rs)
  resolves the next scheduled attempt and moves exhausted work to an explicit
  business status.
- [Kill Bill's payment Janitor](https://github.com/killbill/killbill/blob/master/payment/src/main/java/org/killbill/billing/payment/core/janitor/IncompletePaymentAttemptTask.java)
  records future notifications using status-specific retry lists and stops when
  the configured schedule is exhausted.
- [Saleor's asynchronous webhook transport](https://github.com/saleor/saleor/blob/main/saleor/webhook/transport/asynchronous/transport.py)
  tracks delivery attempts and uses bounded exponential task retry. Saleor also
  scopes transaction and transaction-event idempotency with database uniqueness
  constraints in its [payment model](https://github.com/saleor/saleor/blob/main/saleor/payment/models.py).

## Decision

- Every Inbox row has a persisted `next_dispatch_at`. The Dispatcher selects
  only due, unqueued `RECEIVED` rows and atomically claims one row with
  `UPDATE ... RETURNING`, which returns the exact attempt number owned by that
  claim.
- A failed Redis enqueue clears the lease and schedules the next attempt with a
  five-second exponential base, deterministic 75–100% jitter, and a fifteen
  minute cap. The due-time index starts with status, queue state, and schedule
  time so deferred rows do not consume the active batch.
- Transport dispatch has no automatic discard limit. Unlike an outgoing
  notification, this work represents a provider event that PayFlow has already
  acknowledged; losing it silently is worse than retaining a capped, observable
  retry. Operations can alert and intervene while the row remains recoverable.
- A new SHA-256 `event_fingerprint` binds provider, provider event ID, event
  type, and the provider's normalized payload. JSON object keys are recursively
  sorted before hashing, so harmless field ordering does not change identity. A
  duplicate with another fingerprint is rejected with
  `WEBHOOK_EVENT_ID_CONFLICT`; the transaction does not increment delivery count
  or alter the original row. The fingerprint deliberately excludes the local
  mapped action and synthesized occurrence-time fallbacks, so mapper releases
  cannot misclassify an unchanged upstream event as an identity collision.
- Pre-existing rows with a null fingerprint are compared using a fingerprint
  recomputed from their persisted payload, then bound lazily only when the
  verified replay matches. New rows always receive a fingerprint.
- The ADMIN webhook list now uses an explicit select-list. It exposes safe retry
  diagnostics but never serializes stored provider payloads, normalized actions,
  raw payload hashes, or event fingerprints.

## Consequences

- Redis outages create progressively less database and queue pressure, while
  new due events can move past deferred failures.
- Retry time is deterministic per event and attempt, making tests reproducible,
  but sufficiently spread to avoid synchronized recovery bursts.
- A signed provider event-ID collision becomes a visible integrity incident
  instead of an ordinary duplicate.
- `inbox_dispatch_retry_delay_seconds` and
  `webhook_event_conflict_total` provide low-cardinality operational evidence.
- The extra fingerprint hash is calculated only after provider verification and
  before the Inbox transaction; the 32 KiB request limit bounds its cost.
