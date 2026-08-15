# Refund and administration design

## Invariants

1. Refund amounts are positive integers in the original payment currency.
2. Only successful or partially refunded provider payments can be reserved.
3. For one payment, `SUM(PENDING + SUCCEEDED refunds) <= payment.amount`.
4. `(payment_id, refund_request_id)` and the derived provider idempotency key
   are unique.
5. A provider response or webhook must match the local refund, payment,
   PaymentIntent, amount, and currency before changing state.
6. Refund, Payment, and Order terminal states never move backward.
7. Every administrator request records actor, reason, amount, target, and time.

## Request path

```mermaid
sequenceDiagram
  participant A as ADMIN browser
  participant API as NestJS API
  participant DB as PostgreSQL
  participant P as Persisted Payment Provider

  A->>API: POST /admin/payments/:id/refunds
  API->>DB: Lock order/payment; find request UUID
  alt request already exists
    DB-->>API: Existing Refund
  else new request
    API->>DB: Check cumulative reserved amount
    API->>DB: Insert PENDING Refund + REFUND_REQUESTED audit
  end
  API->>P: refundPayment + stable provider reference
  P-->>API: pending / succeeded / failed snapshot
  API->>DB: Lock and project Refund + Payment + Order + audit
  API-->>A: Local authoritative Refund
  P->>API: Verified refund event or active refund query
  API->>DB: Dedupe Event and project final state atomically
```

Stripe is never called while a database transaction is open. The local
reservation commits first, so another administrator sees the pending amount.
Order-scoped advisory locking and row locks serialize the balance calculation.

## Idempotency and unknown outcomes

The browser generates a version-4 request UUID. PayFlow derives and persists:

```text
refund:create:{paymentId}:{refundRequestId}
```

That exact value is sent as Stripe's `Idempotency-Key` or PayPal's request ID.
For Alipay, the persisted Refund UUID is the stable `out_request_no` for both
`alipay.trade.refund` and `alipay.trade.fastpay.refund.query`. If a mutation
outcome is unknown, the local Refund remains `PENDING`; a repeated request first
queries the same reference and only retries a confirmed-not-found refund. All
provider mutation attempts are gated at least three seconds apart. A terminal
local Refund is returned without another provider call.

## State projection

```text
Refund:  PENDING -> SUCCEEDED | FAILED
Payment: SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
Order:   PAID      -> PARTIALLY_REFUNDED -> REFUNDED
```

A full first refund validates the intermediate Order transition before writing
the final `REFUNDED` state. Aggregate success is recalculated from persisted
successful refunds inside the locked transaction.

## Administration API

| Method | Path                          | Result                                     |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/admin/dashboard`            | Operational counts and refund totals       |
| GET    | `/admin/orders`               | Indexed, filtered, paginated orders        |
| GET    | `/admin/orders/:id`           | Items, payments, attempts, and refunds     |
| GET    | `/admin/payments`             | Provider/status/payment lookup             |
| GET    | `/admin/payments/:id`         | Attempts, provider IDs, and refund totals  |
| POST   | `/admin/payments/:id/refunds` | Idempotent full or partial refund          |
| GET    | `/admin/refunds`              | Paginated provider refund outcomes         |
| GET    | `/admin/webhooks`             | Event status, duplicates, and error reason |
| GET    | `/admin/audit-logs`           | Actor, action, target, metadata, and time  |

All routes are protected by the API's ADMIN guard. Ordinary USER tokens receive
`403`, independent of what the browser renders.

## Stripe event choice

The implementation follows the installed Stripe SDK and current official
Refund event model: `refund.created`, `refund.updated`, and `refund.failed`
drive lifecycle detail. A signed `charge.refunded` event is retained as
`IGNORED`/audit-only rather than used as an ambiguous second projection source.
