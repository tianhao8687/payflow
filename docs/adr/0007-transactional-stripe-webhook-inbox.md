# ADR 0007: Transactional Stripe webhook inbox

Date: 2026-08-13

Status: Accepted

## Context

Stage 4 must treat Stripe's server-side result as authoritative while handling
forged, duplicate, concurrent, and out-of-order deliveries. Stripe requires the
unmodified body for signature verification and does not guarantee exactly-once
or ordered delivery. Payment success and Order paid state must never diverge.

## Decision

- Enable NestJS 11's supported `rawBody: true` option and verify the exact
  `Buffer` with Stripe 22.5.0 `webhooks.constructEvent`.
- Persist every verified Event in `webhook_events`; make
  `provider_event_id` globally unique as required by the specification.
- Serialize duplicate delivery with an event-scoped PostgreSQL advisory lock,
  while retaining the unique index as the final correctness boundary.
- Map provider payloads to local transition commands. Validate sandbox mode,
  PayFlow metadata, provider references, integer amount, and currency before any
  business mutation.
- Share the order advisory-lock boundary with payment creation/cancellation and
  row-lock the affected order/payment. Commit inbox result, Payment, and Order
  changes in one serializable transaction.
- Treat an invalid domain transition as a stale event and persist it as
  `IGNORED`; never regress terminal success/refund states. Persist deterministic
  integrity violations as `FAILED` and return non-2xx.
- Keep processing synchronous in the V1 modular monolith. Queue handoff remains
  the explicitly ordered Stage 8 change.

## Consequences

- The same event can arrive concurrently many times but changes business state
  at most once.
- A process or database failure rolls back the whole transition, allowing a
  Stripe retry to reach a consistent outcome.
- Unknown signed events remain auditable without triggering retry storms.
- The raw Event payload increases database storage, but provides the audit trail
  required by the specification and contains no PayFlow-added card data.
- Stage 8 can enqueue from the existing durable inbox without changing the
  signature or deduplication boundary.
