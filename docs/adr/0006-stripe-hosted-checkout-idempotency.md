# ADR 0006: Hosted Stripe Checkout with stable payment idempotency

- Status: Accepted for implementation; external sandbox gate pending
- Stage: 3

## Context

Stage 3 must create a real Stripe Test Checkout Session without trusting browser
amounts, collecting card data, or allowing repeated clicks and ambiguous network
retries to create unrelated payment operations. Order payment and cancellation
can also race, so checking state outside a shared concurrency boundary is not
sufficient.

## Decision

- Keep `Order` and `Payment` as separate aggregates. A payment copies the
  server-authoritative order amount and currency when its attempt is reserved.
- Use Stripe-hosted Checkout. The browser submits only `orderId`; PayFlow sends
  immutable order-item snapshots as `price_data` line items and never receives
  card numbers or CVC values.
- Reserve a local Stripe payment inside a serializable PostgreSQL transaction.
  Payment reservation and pending-order cancellation take the same transaction-
  scoped advisory lock derived from `orderId`.
- Give each logical provider operation the stable key
  `payment:create:{orderId}:{attemptNo}`. Store that key before the provider
  call and reuse it after retryable or ambiguous failures.
- Call Stripe outside the database transaction, persist each provider call as a
  `PaymentAttempt`, and verify Stripe's returned amount and currency before
  changing the local payment from `CREATED` to `PENDING`.
- Store `orderId` and `paymentId` in Checkout and PaymentIntent metadata and set
  `client_reference_id` to the order ID. A successful browser redirect never
  changes payment or order state.
- Accept only Stripe test/sandbox secret keys. Live keys fail environment
  validation; an absent key makes Checkout return a controlled 503 without
  reserving a payment.
- Use `stripe` 22.5.0 and its pinned API version `2026-07-29.dahlia`, matching
  the installed official SDK types.

## Consequences

- Concurrent duplicate clicks converge on one local payment and one Stripe
  idempotency key. Reusing a completed hosted session does not call Stripe again.
- A cancelled order cannot acquire a new payment record, and payment reservation
  cannot race past cancellation unnoticed.
- A timeout after Stripe accepted a request may leave local state at `CREATED`;
  retrying is safe because the same key asks Stripe for the same operation.
- The result page can show only local `CREATED`, `PENDING`, or later trusted
  states. Stage 4 webhooks remain the final authority for success.
- The implementation can be tested with a fake gateway, but the Stage 3 phase
  gate remains open until a real Stripe Test hosted page is opened.
