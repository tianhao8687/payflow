# Stage 6 — E2E and Failure Lab acceptance record

Date: 2026-08-13

Status: Local gate passed; remote CI pending

Next stage: Blocked until Stage 6 is accepted

## 1. Stage objective

Implement only Stage 6 from the PayFlow specification: automate the critical
payment path and all ten required failure experiments, publish reproducible
commands and evidence, and make the suite a mandatory CI gate.

## 2. Scope and unchanged boundaries

- The Next.js 16, NestJS 11, REST/OpenAPI, PostgreSQL 18, Prisma 7, and Stripe
  Test stack is unchanged.
- Order, Payment, Refund, WebhookEvent, PaymentAttempt, and AuditLog domain
  responsibilities are unchanged.
- No provider abstraction package, worker, queue, PayPal integration, outbox,
  ledger, or reconciliation work from later stages is pulled forward.
- Outbound provider calls alone are deterministic test doubles; HTTP,
  authentication, raw-body verification, repositories, locking, transactions,
  and database constraints are production implementations.

## 3. Added and changed areas

```text
apps/api/test/failure-lab.e2e-spec.ts
apps/api/src/payments/payments.repository.ts
apps/api/src/orders/orders.repository.ts
apps/api/package.json
package.json
.github/workflows/ci.yml

docs/failure-lab-report.md
docs/stages/stage-6.md
README.md
docs/architecture.md
docs/payment-flow.md
```

The payment-reservation and pending-order-cancellation transactions now use
`READ COMMITTED` with their existing transaction-scoped advisory lock. A waiter
therefore observes the lock holder's committed row instead of continuing from a
stale serializable snapshot. Order creation remains serializable.

## 4. Layered test strategy

| Layer       | Acceptance evidence                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Unit        | Existing suites cover price calculation, state transitions, refund limits/idempotency helpers, and permission behavior. |
| Integration | Failure Lab uses Prisma and PostgreSQL for advisory locks, row visibility, aggregate reservations, and rollback.        |
| API         | Existing E2E plus Failure Lab cover Auth, Order, Payment, Refund, and Admin routes.                                     |
| Webhook     | Valid/invalid signatures, duplicates, stale order, unknown events, restart retry, and atomic rollback are automated.    |
| E2E         | Seed product → authenticated order → checkout → signed success → authoritative paid state is automated.                 |

## 5. Ten-scenario acceptance matrix

|   # | Required scenario                                                     | Result |
| --: | --------------------------------------------------------------------- | :----: |
|   1 | Five rapid payment clicks create one provider operation.              |  PASS  |
|   2 | Five deliveries of one webhook change state once.                     |  PASS  |
|   3 | An older event after success cannot regress state.                    |  PASS  |
|   4 | Provider timeout plus client retry cannot duplicate a charge.         |  PASS  |
|   5 | Process restart during webhook handling reaches eventual consistency. |  PASS  |
|   6 | A duplicate refund click cannot duplicate the refund.                 |  PASS  |
|   7 | Concurrent partial refunds cannot exceed the original amount.         |  PASS  |
|   8 | Mid-transition database failure cannot split Payment and Order.       |  PASS  |
|   9 | Invalid webhook signature fails without state change.                 |  PASS  |
|  10 | USER access to the refund API returns 403.                            |  PASS  |

Detailed mechanisms and assertions are in
[`../failure-lab-report.md`](../failure-lab-report.md).

## 6. Reproduction

```powershell
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:failure-lab
```

Run `pnpm test:e2e` to execute both the regular API acceptance suite and the
Failure Lab. Expected error logs are produced by scenarios 4, 5, and 8; the
tests assert the corresponding safe recovery.

## 7. Current verification results

```text
database migration deploy/status      PASS (7 migrations, up to date)
repository formatting                 PASS
monorepo lint + typecheck              PASS
API unit tests                         PASS (16 suites, 62 tests)
combined database-backed API E2E       PASS (2 suites, 21 tests)
dedicated Failure Lab                  PASS (10 tests; 3 repeat runs also pass)
Next.js + NestJS production builds     PASS
remote GitHub Actions                  PENDING
```

GitHub Actions must pass the committed implementation before this record is
accepted.

## 8. Acceptance checklist

- [x] All ten specified failure scenarios have executable assertions.
- [x] The automated payment path reaches authoritative local success by webhook.
- [x] Real PostgreSQL locking and transaction behavior are exercised.
- [x] README documents exact reproduction commands and expected injected errors.
- [x] The CI workflow includes the complete database-backed E2E command.
- [x] Full local static, unit, E2E, and production-build gates pass.
- [ ] GitHub Actions passes the committed Stage 6 implementation.

## 9. Evidence integrity

Failure Lab fixtures are isolated by a per-run prefix and deleted after the
suite. No real Stripe credential is read by the deterministic gateways, no
external payment or refund is created, and no secret is stored in committed
files or test output.

## 10. Phase gate

Stage 6 is not yet accepted. Stage 7 must not begin until the remaining local
and remote checklist items pass and this record is updated with the CI run.
