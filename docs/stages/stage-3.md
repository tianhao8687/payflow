# Stage 3 — Stripe payment acceptance record

Date: 2026-08-12

Status: Accepted

Next stage: Stage 4 not started

## 1. Stage objective

Implement only Stage 3 from the PayFlow specification: a separate local Payment
model, Stripe-hosted Test Checkout, stable third-party idempotency, provider
attempt audit records, payment ownership reads, and a browser result page that
does not trust redirects. Webhook processing remains Stage 4 and has not begun.

## 2. Added and changed areas

```text
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20260812231500_stage_3_stripe_payments/
packages/database/src/index.ts

apps/api/src/payments/**
apps/api/src/config/environment.ts
apps/api/src/orders/**
apps/api/test/app.e2e-spec.ts

apps/web/src/app/payments/**
apps/web/src/components/payment-result.tsx
apps/web/src/components/stripe-checkout-button.tsx
apps/web/src/components/order-detail.tsx
apps/web/src/lib/api.ts

docs/adr/0006-stripe-hosted-checkout-idempotency.md
docs/design/stage-3-payment-design-system.md
docs/stages/stage-3.md
```

## 3. Key design

- The API accepts only `orderId`; Stripe line items come from immutable local
  snapshots and all amounts remain integer minor units.
- A serializable reservation transaction creates a local `Payment` before any
  provider call, with stable key `payment:create:{orderId}:{attemptNo}`.
- Payment creation and order cancellation share a PostgreSQL advisory lock.
- Stripe is called outside the transaction. Each call creates a durable
  `PaymentAttempt`, and returned totals are compared to the local payment.
- Checkout carries `orderId`/`paymentId` metadata and the order client reference.
- Repeated and concurrent clicks reuse one logical provider operation.
- The browser accepts redirects only to HTTPS `checkout.stripe.com` and uses the
  protected local Payment API—not URL query data—for displayed status.
- The runtime accepts only `sk_test_` or `rk_test_` keys and rejects live keys.
- The installed Stripe 22.5.0 client targets API `2026-07-29.dahlia`.
  During the real gate, Stripe rejected legacy `ui_mode=hosted` and required
  `ui_mode=hosted_page`; the gateway now uses and unit-tests that current value.

## 4. Migration

`20260812231500_stage_3_stripe_payments` creates `PaymentProvider`,
`PaymentStatus`, `PaymentAttemptStatus`, `payments`, and `payment_attempts`.
Constraints cover positive amounts/attempt numbers, ISO-style currency, complete
Checkout-field groups, stable unique idempotency keys, provider identifiers, one
attempt number per order/provider, and at most one successful payment per order.

## 5. API and web behavior

| Method | Path                         | Access | Behavior                                 |
| ------ | ---------------------------- | ------ | ---------------------------------------- |
| POST   | `/payments/checkout-session` | JWT    | Reserve/reuse and create hosted Checkout |
| GET    | `/payments/:id`              | JWT    | Read only an owned local payment         |

The order detail exposes sandbox payment and local attempt summaries. The result
route polls local state and explicitly treats a Stripe return as unconfirmed
until a later trusted server-side update.

## 6. Commands and current results

```text
pnpm format                      PASS
pnpm lint                        PASS
pnpm typecheck                   PASS
pnpm test                        PASS (11 suites, 40 tests)
pnpm build                       PASS (web, API, database, shared)
pnpm db:migrate:deploy           PASS (Stage 3 migration applied)
pnpm test:e2e                    PASS (1 suite, 5 acceptance tests)
browser functional checks       PASS (18 checks)
real Stripe Test hosted page    PASS (13 assertions, checkout.stripe.com)
```

The database-backed E2E suite proves concurrent duplicate clicks converge on one
local payment, one stable key, and one fake-provider operation; later reuse does
not call the provider; amounts and line items match server snapshots; ownership
is isolated; cancellation cannot leave a payment; and the order stays pending
until a later authoritative event.

Browser QA proves clear fail-closed behavior with no configured key, no payment
row on that failure, protected local status rendering, rejection of forged
success query values, 320/768/1024/1440 px layouts, and no unexpected console or
runtime errors. The expected 503 resource message accompanies the deliberately
tested missing-key path. The in-app browser kernel was unavailable, so the
bundled Playwright Chromium performed the equivalent checks.

The external gate used a real `sk_test_` credential without logging its value.
Two sequential Checkout requests for one order returned the same local Payment,
the same `cs_test` provider Session, and the same hosted URL. PostgreSQL recorded
one Payment and one provider call. The PayFlow button then opened the rendered
Stripe-hosted page at `checkout.stripe.com`; no card data was entered and no
payment was submitted.

## 7. Acceptance checklist

- [x] Browser sends only an order ID; the server supplies amount and line items.
- [x] A local payment and stable provider idempotency key exist before Stripe is
      called.
- [x] Concurrent duplicate requests reuse one logical Checkout operation.
- [x] Payment and cancellation share a concurrency boundary.
- [x] Live Stripe keys are rejected and a missing test key fails closed.
- [x] Redirect values cannot prove success or update local state.
- [x] Unit, E2E, migration, build, and responsive browser gates pass.
- [x] A real Stripe Test hosted Checkout page opens from the PayFlow UI.

## 8. Phase gate

Stage 3 passed every acceptance criterion in the implementation specification,
including the real Stripe Test hosted-page and third-party idempotency gate.
Stage 4 may now begin.
