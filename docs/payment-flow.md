# PayFlow payment flow

## Authoritative path through Stage 8

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as NestJS API
  participant DB as PostgreSQL
  participant R as PaymentProviderRegistry
  participant P as Stripe Test / PayPal Sandbox
  participant Q as Redis / BullMQ
  participant W as Webhook worker
  participant A as ADMIN browser

  U->>API: POST /orders (productId + quantity)
  API->>DB: Reprice and persist immutable snapshots
  U->>API: POST /payments/checkout-session (orderId + provider)
  API->>DB: Lock order; reserve provider Payment + stable key
  API->>R: createPayment(provider, input)
  R->>P: Hosted Checkout or PayPal Order
  P-->>R: Provider IDs + approval URL
  R-->>API: Normalized CreatePaymentResult
  API->>DB: Validate amount/currency; Payment=PENDING
  API-->>U: Provider-hosted redirect URL
  U->>P: Complete sandbox payment/approval
  P->>API: Provider webhook with exact body + signature headers
  API->>R: verifyWebhook(provider, exact request)
  R-->>API: VerifiedWebhookEvent + normalized action
  API->>DB: Persist/deduplicate RECEIVED event
  API->>Q: Enqueue WebhookEvent UUID
  API->>DB: Record queue job ID/time
  API-->>P: 200 accepted (business processing not awaited)
  Q->>W: Deliver job
  W->>DB: Increment processing attempt and load action
  opt PayPal CHECKOUT.ORDER.APPROVED
    W->>R: capturePayment with stable key
    R->>P: Capture approved PayPal Order
    P-->>R: Normalized capture result
  end
  W->>DB: Validate and atomically project Payment/Refund + Order
  U->>API: GET /payments/:id or GET /orders/:id
  API-->>U: Authoritative PostgreSQL status
  A->>API: GET /admin/queues/webhooks
  API-->>A: Queue counts, states, errors, and attempt totals
```

The browser never submits a price. A provider redirect is not proof of payment,
and a webhook `2xx` is only proof that the signed event was durably accepted and
queued. Payment state becomes authoritative only after the worker commits the
validated PostgreSQL projection.

## Idempotency and concurrency boundaries

1. Business payment: an order reuses its active local Payment and cannot switch
   provider after reservation.
2. Business refund: `(paymentId, refundRequestId)` returns one Refund.
3. Database: payment/refund keys and `provider_event_id` are unique; a partial
   unique index allows at most one successful/refunded Payment per Order.
4. Provider checkout: `payment:create:{provider}:{orderId}:{attemptNo}` is sent
   unchanged as Stripe's idempotency key or PayPal's `PayPal-Request-Id`.
5. Provider refund: `refund:create:{paymentId}:{refundRequestId}` is sent
   unchanged to the persisted provider.
6. Queue: the WebhookEvent UUID is also the BullMQ job ID, so duplicate HTTP
   delivery converges on one retained job.
7. PayPal capture: `payment:capture:{paymentId}` makes an approved-order capture
   safe to retry after an unknown transport outcome.

Concurrent cancellation, payment creation, refund reservation, and webhook
projection share the order-scoped PostgreSQL advisory-lock boundary. Event
delivery also takes an event-scoped lock; database constraints remain the final
defense.

## Retry policy

- BullMQ allows five total attempts with exponential delays starting at one
  second.
- Network failures, provider rate limits, and provider 5xx responses are
  retryable. Each attempt is recorded in PostgreSQL and visible to ADMIN.
- Invalid local identifiers, amount/currency mismatches, forbidden state
  transitions, and unsupported deterministic outcomes are permanent. They use
  `UnrecoverableError` and stop after the first attempt.
- Completed jobs remain observable for one day (up to 1,000); failed jobs remain
  for seven days (up to 2,000).

## Supported Stripe events

| Stripe Event                               | Worker decision                                   |
| ------------------------------------------ | ------------------------------------------------- |
| `checkout.session.completed`               | Paid → success; unpaid → processing               |
| `checkout.session.async_payment_succeeded` | Payment success and Order paid                    |
| `checkout.session.async_payment_failed`    | Payment failed when the state machine permits     |
| `payment_intent.processing`                | Payment processing when the state machine permits |
| `payment_intent.succeeded`                 | Payment success and Order paid                    |
| `payment_intent.payment_failed`            | Payment failed when the state machine permits     |
| `refund.created`, `refund.updated`         | Project current Refund lifecycle snapshot         |
| `refund.failed`                            | Mark pending Refund failed with provider reason   |
| `charge.refunded`                          | Persist as audit-only `IGNORED`                   |
| Any other signed Event                     | Persist as `IGNORED`; no business mutation        |

## Supported PayPal events

| PayPal Event                                           | Worker decision                                |
| ------------------------------------------------------ | ---------------------------------------------- |
| `CHECKOUT.ORDER.APPROVED`                              | Idempotently capture the approved order        |
| `PAYMENT.CAPTURE.COMPLETED`                            | Payment success and Order paid                 |
| `PAYMENT.CAPTURE.PENDING`                              | Payment processing                             |
| `PAYMENT.CAPTURE.DECLINED/DENIED/REVERSED`             | Payment failed when allowed                    |
| `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.COMPLETED` | Finalize successful Refund and aggregate state |
| `PAYMENT.REFUND.PENDING`                               | Keep Refund pending                            |
| `PAYMENT.REFUND.FAILED`                                | Mark Refund failed                             |
| Any other verified event                               | Persist as `IGNORED`; no business mutation     |

## Refund aggregate state

```text
Refund:  PENDING -> SUCCEEDED | FAILED
Payment: SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
Order:   PAID      -> PARTIALLY_REFUNDED -> REFUNDED
```

Direct provider responses and verified queued events share the same refund
projection. Failed amounts do not consume the remaining balance; pending and
successful amounts do.
