# Stage 5 — Refund and administration acceptance record

Date: 2026-08-13

Status: Implemented; remote CI pending

Next stage: Stage 6 blocked by this phase gate

## 1. Stage objective

Implement only Stage 5 from the PayFlow specification: serialized full and
partial Stripe refunds, cumulative amount protection, end-to-end idempotency,
asynchronous provider state, administrator audit records, paginated operations
APIs, and a responsive admin console.

## 2. Added and changed areas

```text
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20260813003000_stage_5_refunds_admin/

apps/api/src/refunds/**
apps/api/src/admin/**
apps/api/src/webhooks/**
apps/api/test/app.e2e-spec.ts

apps/web/src/components/admin-console.tsx
apps/web/src/components/admin-boundary.tsx
apps/web/src/components/order-detail.tsx
apps/web/src/lib/api.ts

docs/adr/0008-serialized-idempotent-refunds.md
docs/refund-design.md
docs/stages/stage-5.md
```

## 3. Key design decisions

- A locked transaction reserves `PENDING` before Stripe is called and counts
  both pending and successful refunds against the original integer amount.
- `(paymentId, refundRequestId)` is the business identity. The provider receives
  `refund:create:{paymentId}:{refundRequestId}` as its stable idempotency key.
- Verified direct responses and signed Refund events share one projection
  function and explicit Refund, Payment, and Order state machines.
- Unknown provider outcomes remain pending for same-key retry; deterministic
  rejection becomes failed and releases its reservation.
- Current Stripe `refund.created`, `refund.updated`, and `refund.failed` events
  drive lifecycle detail. `charge.refunded` is persisted as audit-only.
- Every administrator refund writes actor, reason, amount, target, and time.
  System webhook projection writes a separate system audit record.
- Dashboard totals are grouped by currency. All list APIs are bounded,
  paginated, filtered, newest-first, and backed by database indexes.
- Explicit advisory/row locking uses `READ COMMITTED`, avoiding stale snapshots
  after lock waits while retaining the domain serialization boundary.

## 4. Acceptance evidence

| Criterion                                           | Evidence                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| Cumulative refunds never exceed original amount     | Deterministic concurrent PostgreSQL E2E gate          |
| Duplicate refund click is idempotent                | Same local/provider ID and stable provider key        |
| Ordinary USER cannot call administrator APIs        | GET and POST both return `403 AUTH_FORBIDDEN`         |
| Pending acknowledgement is not treated as final     | Pending response finalized by signed `refund.updated` |
| Full and partial projection updates aggregate state | Payment/Order partial, then fully refunded in E2E     |
| Administrator action is auditable                   | Actor/reason/amount/time/target asserted by E2E       |
| Admin lists are operational                         | All list/detail/filter/pagination routes asserted     |
| Customer can see refund records                     | Owned Order response and UI include refund history    |
| Real Stripe Test refund succeeds                    | One provider Refund; same-key replay reuses it        |

## 5. Current verification results

```text
database migration deploy/status     PASS
API lint + typecheck                  PASS
API unit tests                        PASS (16 suites, 62 tests)
database-backed API E2E               PASS (1 suite, 11 tests)
Next.js lint + typecheck + build      PASS
browser admin workflows              PASS (320/1440, no errors/overflow)
real Stripe Test checkout + refund   PASS
remote GitHub Actions                PENDING
```

The external sandbox check completed a real hosted Checkout, projected its
signed successful PaymentIntent locally, issued a full Stripe refund, and sent
the same refund request again. Stripe reported one matching successful Refund;
PayFlow returned the same local and provider IDs with `reused: true` and left
Payment/Order in `REFUNDED`.

## 6. Acceptance checklist

- [x] Full and partial refund requests are supported.
- [x] Cumulative pending/successful reservations cannot exceed payment amount.
- [x] Third-party refund uses a stable idempotency key.
- [x] Refund lifecycle distinguishes pending, succeeded, and failed.
- [x] Signed current Stripe Refund events finalize lifecycle state.
- [x] Every administrator refund creates an attributable audit record.
- [x] Dashboard, orders, payments, refunds, webhooks, and audit UI are present.
- [x] Admin lists are paginated and indexed.
- [x] Ordinary USER receives 403 for administration routes.
- [x] Local static, unit, E2E, production, and browser gates pass.
- [ ] GitHub Actions passes the committed Stage 5 implementation.

## 7. Phase gate

Stage 6 must not begin until the remaining remote CI checkbox is accepted.
