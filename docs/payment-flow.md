# PayFlow payment flow

## Authoritative path through Stage 4

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as NestJS API
  participant DB as PostgreSQL
  participant S as Stripe Test

  U->>API: POST /orders (productId + quantity)
  API->>DB: Reprice and persist order snapshots
  U->>API: POST /payments/checkout-session (orderId)
  API->>DB: Reserve Payment + stable idempotency key
  API->>S: Create hosted Checkout Session
  S-->>API: Session ID + hosted URL
  API->>DB: Persist provider references; Payment=PENDING
  API-->>U: Hosted URL
  U->>S: Complete sandbox checkout
  S->>API: POST /webhooks/stripe (raw Event + signature)
  API->>API: Verify exact bytes and map event
  API->>DB: Persist/dedupe event and atomically transition state
  DB-->>API: Payment=SUCCEEDED, Order=PAID
  U->>API: GET /payments/:id or GET /orders/:id
  API-->>U: Authoritative local status
```

The browser submits no price to either order or payment APIs. Order totals come
from server-loaded products and immutable order-item snapshots. A redirect from
Stripe can only start polling; query parameters and the success page never
write payment state.

## Idempotency boundaries

1. Business: an order reuses its active local Payment.
2. Database: payment keys and Stripe `provider_event_id` values are unique.
3. Provider: Checkout creation uses
   `payment:create:{orderId}:{attemptNo}` as Stripe's idempotency key.

Concurrent cancellation, payment creation, and webhook transitions share the
order-scoped PostgreSQL advisory-lock boundary. Duplicate webhook deliveries
also take an event-scoped advisory lock and are ultimately protected by the
database unique constraint.

## Supported Stage 4 events

| Stripe Event                               | Local decision                                    |
| ------------------------------------------ | ------------------------------------------------- |
| `checkout.session.completed`               | Paid → success; unpaid → processing               |
| `checkout.session.async_payment_succeeded` | Payment success and Order paid                    |
| `checkout.session.async_payment_failed`    | Payment failed when the state machine permits     |
| `payment_intent.processing`                | Payment processing when the state machine permits |
| `payment_intent.succeeded`                 | Payment success and Order paid                    |
| `payment_intent.payment_failed`            | Payment failed when the state machine permits     |
| Any other signed Event                     | Persist as `IGNORED`; no business mutation        |

Successful processing validates PayFlow metadata, provider references, integer
amount, and currency before changing state. Refund events remain Stage 5 scope.
