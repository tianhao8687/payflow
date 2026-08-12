# PayFlow payment flow

## Authoritative path through Stage 7

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as NestJS API
  participant DB as PostgreSQL
  participant P as PaymentProvider / StripeProvider
  participant S as Stripe Test
  participant A as ADMIN browser

  U->>API: POST /orders (productId + quantity)
  API->>DB: Reprice and persist order snapshots
  U->>API: POST /payments/checkout-session (orderId)
  API->>DB: Reserve Payment + stable idempotency key
  API->>P: createPayment(input + stable key)
  P->>S: Create hosted Checkout Session
  S-->>P: Session ID + hosted URL
  P-->>API: Normalized CreatePaymentResult
  API->>DB: Persist provider references; Payment=PENDING
  API-->>U: Hosted URL
  U->>S: Complete sandbox checkout
  S->>API: POST /webhooks/stripe (raw Event + signature)
  API->>P: verifyWebhook(raw bytes + signature)
  P-->>API: VerifiedWebhookEvent + normalized action
  API->>DB: Persist/dedupe event and atomically transition state
  DB-->>API: Payment=SUCCEEDED, Order=PAID
  U->>API: GET /payments/:id or GET /orders/:id
  API-->>U: Authoritative local status
  A->>API: POST /admin/payments/:id/refunds
  API->>DB: Lock and reserve PENDING Refund + audit
  API->>P: refundPayment(input + stable key)
  P->>S: Create Refund
  S-->>P: Refund provider snapshot
  P-->>API: Normalized RefundPaymentResult
  API->>DB: Project Refund + Payment + Order
  S->>API: Signed refund.created/updated/failed
  API->>DB: Dedupe and finalize refund state atomically
  A->>API: GET admin operations resources
  API-->>A: Paginated state, failures, duplicates, and audit
```

The browser submits no price to either order or payment APIs. Order totals come
from server-loaded products and immutable order-item snapshots. A redirect from
Stripe can only start polling; query parameters and the success page never
write payment state.

## Idempotency boundaries

1. Business: an order reuses its active local Payment.
2. Business refund: `(paymentId, refundRequestId)` returns one Refund.
3. Database: payment/refund keys and Stripe `provider_event_id` values are
   unique.
4. Provider Checkout: creation uses
   `payment:create:{orderId}:{attemptNo}` as Stripe's idempotency key.
5. Provider refund: creation uses
   `refund:create:{paymentId}:{refundRequestId}` as Stripe's idempotency key.

Concurrent cancellation, payment creation, refund reservation, and webhook
transitions share the order-scoped PostgreSQL advisory-lock boundary. Refund
balance checks count `PENDING + SUCCEEDED` rows under that lock. Duplicate
webhook deliveries also take an event-scoped advisory lock and are ultimately
protected by the database unique constraint.

## Supported events through Stage 7

| Stripe Event                               | Local decision                                    |
| ------------------------------------------ | ------------------------------------------------- |
| `checkout.session.completed`               | Paid → success; unpaid → processing               |
| `checkout.session.async_payment_succeeded` | Payment success and Order paid                    |
| `checkout.session.async_payment_failed`    | Payment failed when the state machine permits     |
| `payment_intent.processing`                | Payment processing when the state machine permits |
| `payment_intent.succeeded`                 | Payment success and Order paid                    |
| `payment_intent.payment_failed`            | Payment failed when the state machine permits     |
| `refund.created`                           | Persist current Refund lifecycle snapshot         |
| `refund.updated`                           | Finalize pending Refund when identifiers match    |
| `refund.failed`                            | Mark pending Refund failed with provider reason   |
| `charge.refunded`                          | Persist as audit-only `IGNORED`                   |
| Any other signed Event                     | Persist as `IGNORED`; no business mutation        |

Successful processing validates PayFlow metadata, provider references, integer
amount, and currency before changing state. Current Stripe Refund events carry
the local `refundId`, `paymentId`, and `orderId` metadata required for the same
projection used by the direct Refunds API response.

## Refund aggregate state

```text
Refund:  PENDING -> SUCCEEDED | FAILED
Payment: SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
Order:   PAID      -> PARTIALLY_REFUNDED -> REFUNDED
```

An accepted provider request is not automatically a final refund. PayFlow keeps
pending outcomes pending until a verified response or signed Refund event says
otherwise. Failed amounts no longer consume the available balance; pending and
successful amounts do.
