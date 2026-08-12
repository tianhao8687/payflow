# ADR 0008: Serialized idempotent refunds with audited administration

- Status: Accepted
- Stage: 5
- Date: 2026-08-13

## Context

An administrator can issue full or partial refunds while duplicate clicks,
network ambiguity, concurrent administrators, and delayed Stripe events are all
possible. The sum of pending and successful refunds must never exceed the
original payment. A provider acknowledgement may be pending rather than final,
and every administrator decision needs an attributable reason and timestamp.

## Decision

- Keep `Refund` separate from `Payment`. Store integer amount, explicit
  `PENDING`, `SUCCEEDED`, or `FAILED` state, administrator reason, local request
  UUID, stable provider key, provider IDs, and failure details.
- Lock the shared order boundary and affected rows before calculating the
  cumulative `PENDING + SUCCEEDED` reservation. Commit the reservation and
  `REFUND_REQUESTED` audit row together before calling Stripe.
- Use `refund:create:{paymentId}:{refundRequestId}` as Stripe's
  `Idempotency-Key`. A repeated local request UUID returns the same Refund and
  provider operation.
- Call Stripe outside the database transaction. Project a verified response in
  a new locked transaction and update Refund, Payment, and Order through their
  explicit state machines.
- Treat timeouts and unverified transport outcomes as unknown: retain
  `PENDING` and require retry with the same request UUID. Persist deterministic
  provider rejection as `FAILED` so its amount becomes available to a new
  request.
- Reconcile asynchronous results from current Stripe `refund.created`,
  `refund.updated`, and `refund.failed` events. Persist `charge.refunded` as
  audit-only because current Stripe guidance uses Refund events for detailed
  lifecycle state.
- Protect every `/admin/**` operation with the existing server-side ADMIN role
  guard. Paginate indexed order, payment, refund, webhook, and audit queries.
- Store administrator and system audit records without secrets or card data.
  Dashboard refund totals are grouped by currency rather than added across
  unlike currencies.
- Use transaction-scoped advisory and row locks with PostgreSQL
  `READ COMMITTED`. The lock-after-wait statement can then read the newest
  committed state; `SERIALIZABLE` snapshots taken while waiting caused
  unnecessary retry conflicts under concurrent webhook delivery.

## Consequences

- Concurrent refund requests cannot reserve more than the original payment,
  even when the Stripe calls overlap.
- Provider calls are safely replayable after ambiguous network failures without
  creating a second provider refund.
- A successful partial aggregate moves Payment and Order to
  `PARTIALLY_REFUNDED`; a complete aggregate moves both to `REFUNDED`.
- Operations staff can trace the actor, reason, amount, target, provider
  outcome, duplicate deliveries, and failure reason from one console.
- The synchronous provider call remains within the V1 modular monolith. Stage 8
  will move provider work to the specified queue/worker boundary without
  changing the request identity or database reservation rules.
