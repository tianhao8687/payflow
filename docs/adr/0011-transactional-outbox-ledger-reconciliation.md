# ADR 0011: Transactional outbox, double-entry ledger, and reconciliation

- Status: Accepted for Stage 9 implementation
- Date: 2026-08-13

## Context

Provider webhooks make Order, Payment, and Refund state authoritative in
PostgreSQL, but a later asynchronous accounting effect must not be lost between
a database commit and a queue write. PayFlow also needs an independently
enforced financial record and a way to discover divergence between local and
provider state.

## Decision

- Append payment/refund success events to `outbox_events` in the same Prisma
  transaction as the state projection. Stable event keys make repeated provider
  delivery converge.
- Poll pending rows from the standalone worker and enqueue each OutboxEvent UUID
  as its BullMQ job ID. Record publish and processing attempts in PostgreSQL;
  retry transient errors five times with exponential backoff and retain terminal
  failures.
- Convert each money event exactly once into a `ledger_transactions` row with a
  debit/credit pair. Reverse the payment accounts for refunds.
- Enforce balance, minimum entry count, and currency consistency with a deferred
  PostgreSQL constraint trigger. Application checks are observability only; the
  database constraint is authoritative.
- Reconcile a bounded time window by querying the persisted provider adapter,
  comparing amount/currency/status/refund total, and retaining every check.
  Provider lookup errors are run errors, not fabricated mismatches.
- Keep one open issue per payment and issue type, retain both snapshots, and
  require an audited ADMIN action to resolve it.
- Give the worker a dedicated Stripe test read key. Prefer a restricted key and
  keep all credentials in ignored environment files or a secret manager.

## Consequences

- A successful business-state commit cannot exist without its durable outbox
  event. Queue outages increase pending age but do not erase the event.
- At-least-once queue delivery cannot duplicate accounting because
  `ledger_transactions.outbox_event_id` is unique and processing is serialized
  with a transaction-scoped advisory lock.
- Invalid or one-sided ledger writes fail at commit even if they bypass normal
  application code.
- Reconciliation history is inspectable separately from current open issues;
  repeated scans refresh the open issue rather than multiplying it.
- PayPal capture lookup does not supply an exact cumulative refund total. The
  adapter reports that field as unavailable instead of asserting a false zero;
  Stripe performs the exact refund-total comparison through expanded Charge
  data.
