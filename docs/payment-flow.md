# PayFlow payment flow

## Authoritative path through Stage 10

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
  participant O as OpenTelemetry backend

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
  Note over API,Q: Inject W3C trace context into job data
  API->>DB: Record queue job ID/time
  API-->>P: 200 accepted (business processing not awaited)
  Q->>W: Deliver job
  Note over Q,W: Extract parent context; continue the same trace
  W->>DB: Increment processing attempt and load action
  opt PayPal CHECKOUT.ORDER.APPROVED
    W->>R: capturePayment with stable key
    R->>P: Capture approved PayPal Order
    P-->>R: Normalized capture result
  end
  W->>DB: Validate and atomically project Payment/Refund + Order + OutboxEvent
  loop Outbox publisher
    W->>DB: Poll durable PENDING money events
    W->>Q: Enqueue OutboxEvent UUID
    W->>DB: Record published_at and queue job ID
  end
  Q->>W: Deliver outbox job (at least once)
  W->>DB: Post balanced debit/credit pair + mark event processed
  loop Scheduled reconciliation
    W->>DB: Select bounded local payment window
    W->>R: getPayment(persisted provider ID)
    R->>P: Read provider payment/capture
    P-->>R: Amount, currency, status, available refund total
    W->>DB: Persist check, snapshots, and any open issue
  end
  U->>API: GET /payments/:id or GET /orders/:id
  API-->>U: Authoritative PostgreSQL status
  A->>API: GET /admin/integrity
  API-->>A: Outbox, balanced ledger, runs, and differences
  A->>API: PATCH /admin/reconciliation/issues/:id/resolve
  API->>DB: Resolve once + append ADMIN audit
  API-->>O: Optional OTLP traces; JSON logs + :9464 metrics
  W-->>O: Optional OTLP traces; JSON logs + :9465 metrics
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
8. Financial outbox: payment/refund success uses a stable event key and appends
   inside the same state transaction.
9. Outbox queue: the OutboxEvent UUID is the BullMQ job ID; the same UUID is
   unique on `ledger_transactions`, so at-least-once delivery posts once.

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
- Outbox jobs use the same five-attempt exponential policy, retain completed and
  failed jobs with bounded counts, and persist publish/processing attempts plus
  safe terminal errors in PostgreSQL.

## Ledger and reconciliation invariants

- Payment success debits provider receivable and credits customer payment
  clearing; refund success reverses those directions.
- Every amount is an integer minor unit. A deferred PostgreSQL constraint
  trigger requires at least two entries, identical transaction/account/entry
  currency, and a zero debit-minus-credit sum at commit.
- Scheduled reconciliation compares local/provider amount, currency, normalized
  status, and cumulative refund total when the provider lookup supplies it.
  Stripe expands `latest_charge` for `amount_refunded`; PayPal's capture lookup
  reports the cumulative refund value as unavailable rather than inventing it.
- Checks retain both snapshots. Concurrent mismatches converge on one open issue
  per payment/type; only ADMIN may resolve it, and resolution is audited once.

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
