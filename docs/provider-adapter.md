# Payment provider adapter

## Boundary

Stage 7 separated provider-neutral orchestration from Stripe transport. Stage 8
adds PayPal Sandbox and runtime selection without changing the persisted Order,
Payment, Refund, WebhookEvent, and AuditLog domain model.

```text
NestJS Payments / Refunds / Webhooks + Worker
                    |
                    v
        @payflow/payment-core
        PaymentProviderRegistry
             /              \
            v                v
 @payflow/payment-stripe  @payflow/payment-paypal
       Stripe Test           PayPal Sandbox
```

`payment-core` has no dependency on NestJS, Prisma, the database package, or a
provider SDK. Both provider adapters have no dependency on NestJS or PayFlow
database types. The API composition module and standalone worker bootstrap are
the only production composition roots allowed to construct adapters.

## Contract

| Method            | Stripe Test mapping                        | PayPal Sandbox mapping                         |
| ----------------- | ------------------------------------------ | ---------------------------------------------- |
| `createPayment`   | Hosted Checkout Session                    | Orders v2 create + approval URL                |
| `getPayment`      | `paymentIntents.retrieve`                  | Order/capture lookup                           |
| `capturePayment?` | `paymentIntents.capture`                   | Capture approved Order                         |
| `cancelPayment?`  | `paymentIntents.cancel`                    | Normalize an uncaptured Order as locally ended |
| `refundPayment`   | Refund against a PaymentIntent             | Refund against a capture                       |
| `verifyWebhook`   | Exact-byte signature verification + mapper | Official verification endpoint + mapper        |

Stable idempotency keys remain business inputs:

```text
payment:create:{provider}:{orderId}:{attemptNo}
refund:create:{paymentId}:{refundRequestId}
payment:capture:{paymentId}
```

The adapter must never generate a random replacement for either key.

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

## Webhook envelope

`verifyWebhook` returns `VerifiedWebhookEvent` containing:

- provider name, event ID, event type, occurrence time, and the verified
  provider payload for durable audit;
- `IGNORE` or `REJECT` for non-business/live/invalid event semantics;
- `PAYMENT_TRANSITION` with local identifiers, amount, currency, provider
  references, and normalized target status; or
- `REFUND_SYNC` with local/provider identifiers and normalized refund state.

The HTTP Webhooks repository imports no provider types. It persists the
normalized action and enqueues a database event UUID. `payment-domain` later
applies advisory locks, integrity checks, and explicit transitions in the
worker.

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
