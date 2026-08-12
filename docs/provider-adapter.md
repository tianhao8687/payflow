# Payment provider adapter

## Boundary

Stage 7 separates provider-neutral payment orchestration from Stripe transport
details without changing the modular-monolith deployment or the persisted
Order, Payment, Refund, WebhookEvent, and AuditLog model.

```text
NestJS Payments / Refunds / Webhooks services
                    |
                    v
        @payflow/payment-core
        PaymentProvider contract
                    ^
                    |
        @payflow/payment-stripe
        StripeProvider implementation
                    |
                    v
             Stripe Test SDK
```

`payment-core` has no dependency on NestJS, Prisma, the database package, or a
provider SDK. `payment-stripe` has no dependency on NestJS or PayFlow database
types. The API composition module is the only production file allowed to know
which implementation is bound to the core injection token.

## Contract

| Method            | Provider-neutral responsibility                                                                                                     | Stripe mapping                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `createPayment`   | Create a payment entry point from integer amount, currency, immutable lines, local identifiers, URLs, and a stable idempotency key. | Hosted Checkout Session creation.                 |
| `getPayment`      | Read a current normalized provider payment snapshot.                                                                                | `paymentIntents.retrieve`.                        |
| `capturePayment?` | Optionally capture an authorized payment with a stable key.                                                                         | `paymentIntents.capture`.                         |
| `cancelPayment?`  | Optionally cancel a provider payment with a stable key.                                                                             | `paymentIntents.cancel`.                          |
| `refundPayment`   | Submit a full/partial refund with immutable local metadata and a stable key.                                                        | Refund creation against a PaymentIntent.          |
| `verifyWebhook`   | Verify exact request bytes and return a normalized event/action.                                                                    | Stripe signature verification plus Event mapping. |

Stable idempotency keys remain business inputs:

```text
payment:create:{orderId}:{attemptNo}
refund:create:{paymentId}:{refundRequestId}
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

The Webhooks repository no longer imports Stripe types. It maps the normalized
status to the persisted enum, then applies the same advisory locks, transaction,
deduplication constraint, integrity checks, and explicit domain transitions as
before Stage 7.

## Error contract

`PaymentProviderError` carries provider, operation, provider code, safe message,
request ID, and `outcomeUnknown`. Business services use this contract for
provider-attempt audit and safe same-key retry behavior. SDK error classes do
not cross the adapter boundary.

Network, provider 5xx, rate-limit, and provider-idempotency transport failures
may have unknown mutation outcomes. Deterministic provider validation/rejection
errors do not. Unexpected mutation failures also fail conservatively as
outcome-unknown.

## Dependency enforcement

- API production source cannot import `stripe`.
- API business source cannot import `@payflow/payment-stripe`; only
  `src/providers/payment-provider.module.ts` is the composition root.
- `@payflow/payment-core` cannot import `stripe`.
- Scoped ESLint `no-restricted-imports` rules enforce all three constraints in
  local and GitHub Actions lint gates.

## Verification

```powershell
pnpm --filter @payflow/payment-core lint
pnpm --filter @payflow/payment-core typecheck
pnpm --filter @payflow/payment-stripe lint
pnpm --filter @payflow/payment-stripe typecheck
pnpm --filter @payflow/payment-stripe test
pnpm test:e2e
```

Adapter tests cover hosted Checkout field/key mapping, PaymentIntent lookup,
capture/cancel status normalization, refund metadata/key mapping, pending and
unknown refund outcomes, exact-byte signature verification, live-mode rejection,
current Refund events, audit-only `charge.refunded`, and unknown events.

## Deferred to Stage 8

This stage deliberately does not add PayPal, a runtime provider selector,
Redis, BullMQ, `apps/worker`, asynchronous webhook jobs, or retry dashboards.
Those changes require their own schema/runtime and acceptance gate.
