# Payment provider adapter

## Boundary

Stage 7 separated provider-neutral orchestration from Stripe transport, Stage 8
added PayPal Sandbox, and Stage 11 adds Alipay PC web sandbox without changing
provider ownership of the persisted Order, Payment, Refund, WebhookEvent, and
AuditLog domain model.

```text
NestJS Payments / Refunds / Webhooks + Worker
                    |
                    v
        @payflow/payment-core
        PaymentProviderRegistry
       /                |                 \
      v                 v                  v
 payment-stripe   payment-paypal    payment-alipay
  Stripe Test     PayPal Sandbox    Alipay Sandbox
```

`payment-core` has no dependency on NestJS, Prisma, the database package, or a
provider SDK. All provider adapters have no dependency on NestJS or PayFlow
database types. The API composition module and standalone worker bootstrap are
the only production composition roots allowed to construct adapters.

## Contract

| Method                  | Stripe Test                         | PayPal Sandbox                                 | Alipay Sandbox                          |
| ----------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `createPayment`         | Hosted Checkout Session             | Orders v2 + approval URL                       | `alipay.trade.page.pay`                 |
| `getPaymentByReference` | Session/PaymentIntent lookup        | Order/capture lookup                           | `alipay.trade.query` by `out_trade_no`  |
| `capturePayment?`       | PaymentIntent capture               | Capture approved Order                         | not applicable                          |
| `cancelPayment?`        | Expire Session/cancel PaymentIntent | fail closed when active Order cannot be closed | `alipay.trade.close` after unpaid query |
| `refundPayment`         | Refund against PaymentIntent        | Refund against capture                         | `alipay.trade.refund`                   |
| `getRefund?`            | optional                            | optional                                       | `alipay.trade.fastpay.refund.query`     |
| `verifyWebhook`         | exact raw-byte signature            | official verification endpoint                 | official RSA2 form verification         |

Stable idempotency keys remain business inputs:

```text
payment:create:{provider}:{orderId}:{attemptNo}
refund:create:{paymentId}:{refundRequestId}
payment:capture:{paymentId}
```

The adapter must never generate a random replacement for either key. The core
also distinguishes `merchantReference`, nullable provider transaction ID,
nullable checkout-session ID, checkout URL, and checkout expiry. Alipay maps the
Payment UUID to `out_trade_no`; `trade_no` remains null until notification or
query proves it.

## Normalized states

Stripe payment states are translated before they reach business code:

| Stripe PaymentIntent status                                           | ProviderPaymentStatus |
| --------------------------------------------------------------------- | --------------------- |
| `requires_payment_method`, `requires_confirmation`, `requires_action` | `PENDING`             |
| `processing`, `requires_capture`                                      | `PROCESSING`          |
| `succeeded`                                                           | `SUCCEEDED`           |
| `canceled`                                                            | `FAILED`              |

Stripe Refund states are translated as follows:

| Stripe Refund status         | ProviderRefundStatus |
| ---------------------------- | -------------------- |
| `pending`, `requires_action` | `PENDING`            |
| `succeeded`                  | `SUCCEEDED`          |
| `failed`, `canceled`         | `FAILED`             |

Unknown Refund states fail closed with an outcome-unknown provider error. The
existing Order, Payment, and Refund state machines still decide whether a
normalized event may change local state.

Alipay maps `WAIT_BUYER_PAY` to pending and `TRADE_SUCCESS`/`TRADE_FINISHED` to
success. `TRADE_CLOSED` is failed only for an unpaid local attempt; a late close
cannot regress successful or refunded local state. CNY conversion is performed
with decimal strings and integer arithmetic only. Provider network, rate-limit,
and system errors use at most three exponential-backoff attempts with jitter;
mutations reuse stable merchant/refund references on every attempt.

## Webhook envelope

`verifyWebhook` returns `VerifiedWebhookEvent` containing:

- provider name, event ID, event type, occurrence time, and the verified
  provider payload for durable audit;
- `IGNORE` or `REJECT` for non-business/live/invalid event semantics;
- `PAYMENT_TRANSITION` with local identifiers, amount, currency, provider
  references, and normalized target status; or
- `REFUND_SYNC` with local/provider identifiers and normalized refund state.

The HTTP Webhooks repository imports no provider types. It persists the
normalized action; the Worker-side Inbox Dispatcher later enqueues the database
event UUID. `payment-domain` applies advisory locks, integrity checks, and
explicit transitions in the worker.

## Error contract

`PaymentProviderError` carries provider, operation, provider code, safe message,
request ID, `outcomeUnknown`, and `retryable`. Business services use the first
flag for safe same-key mutation retry; the worker uses the second to distinguish
transient BullMQ retry from deterministic permanent failure. SDK error classes
do not cross the adapter boundary.

Network, provider 5xx, rate-limit, and provider-idempotency transport failures
may have unknown mutation outcomes. Deterministic provider validation/rejection
errors do not. Unexpected mutation failures also fail conservatively as
outcome-unknown.

## Dependency enforcement

- API production source cannot import `stripe`.
- API business source cannot import either provider adapter; only
  `src/providers/payment-provider.module.ts` is the API composition root.
- `@payflow/payment-core` cannot import `stripe`.
- The worker bootstrap is explicitly permitted to construct both adapters;
  its runtime processor depends on the core registry and payment-domain.
- Scoped ESLint `no-restricted-imports` rules enforce these constraints in
  local and GitHub Actions lint gates.

## Verification

```powershell
pnpm --filter @payflow/payment-core lint
pnpm --filter @payflow/payment-core typecheck
pnpm --filter @payflow/payment-stripe lint
pnpm --filter @payflow/payment-stripe typecheck
pnpm --filter @payflow/payment-stripe test
pnpm --filter @payflow/payment-paypal test
pnpm --filter @payflow/payment-queue test
pnpm test:stage-8
```

Adapter tests cover hosted Checkout and PayPal Order field/key mapping,
PaymentIntent/PayPal lookup and capture, refund normalization, exact-byte
signature verification, provider webhook mapping, decimal/minor-unit conversion,
and transient/permanent error classification. Stage 8 E2E covers the shared
business interface and observable worker retry against real PostgreSQL/Redis.
