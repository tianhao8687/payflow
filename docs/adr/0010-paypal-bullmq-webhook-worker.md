# ADR 0010: Provider registry and durable asynchronous webhook worker

- Status: Accepted for Stage 8 implementation
- Date: 2026-08-13

## Context

Stage 7 isolated Stripe behind `PaymentProvider`. Stage 8 requires PayPal
through that same business interface and moves complex webhook effects out of
the request process. Provider events must still be authenticated and durably
received before acknowledgement, transient failures must retry visibly, and
PostgreSQL must remain authoritative.

## Decision

- Register Stripe and PayPal implementations in `PaymentProviderRegistry`.
  Payment creation chooses a provider once; later lookup, capture, refund, and
  event projection route by the persisted provider.
- Implement PayPal only against Sandbox Orders v2, capture/refund APIs, OAuth,
  `PayPal-Request-Id`, and the official webhook-signature verification endpoint.
- In each webhook HTTP request, verify exact raw bytes, normalize the provider
  event, insert/deduplicate `webhook_events`, enqueue its database UUID as a
  BullMQ job, record the job ID, and return immediately.
- Run business processing in `apps/worker` through the shared
  `@payflow/payment-domain` store and the same provider registry.
- Use five total attempts with exponential backoff starting at one second for
  retryable transport/provider failures. Mark deterministic integrity and
  state-machine failures unrecoverable after the first attempt.
- Use the WebhookEvent UUID as BullMQ `jobId`. Retain completed jobs for one day
  and failed jobs for seven days within bounded counts, and expose a read-only
  ADMIN queue snapshot.
- Keep Redis as queue transport/telemetry only. PostgreSQL owns provider event,
  attempt, error, Payment, Refund, and Order truth.
- Give the worker only PayPal Sandbox OAuth values required for capture. Stripe
  and provider webhook-verification secrets stay exclusively in the API.

## Consequences

- A webhook `2xx` means authenticated and durably queued, not necessarily that
  the payment transition has finished. Clients continue to read local status.
- If enqueue fails after the inbox insert, the request fails and the provider's
  duplicate delivery safely reuses the persisted `RECEIVED` event.
- A worker restart can resume retained jobs without replaying provider payloads
  through an unauthenticated path.
- Permanent failures remain visible in both PostgreSQL and BullMQ instead of
  consuming all retry attempts.
- An outbox, accounting ledger, and reconciliation jobs remain Stage 9 work;
  Stage 8 does not introduce them early.
