# PayFlow Stage 6 Failure Lab report

Date: 2026-08-13

Status: Accepted

## Purpose

This report maps the ten failure experiments required by the PayFlow
implementation specification to executable assertions. The suite drives the
real NestJS HTTP application and PostgreSQL database. It replaces only outbound
Stripe calls with deterministic gateways so timing, retries, and provider
idempotency can be reproduced without an external network dependency.

The regular E2E suite remains responsible for the complete Auth, Order,
Payment, Refund, Admin, and webhook API path. Stage 5 separately records the
successful real Stripe Test Checkout and Refund acceptance run.

## Test strategy coverage

| Layer       | Stage 6 coverage                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Price rules, explicit Order/Payment/Refund state machines, refund ceiling, stable idempotency keys, and role guards remain in the normal Jest suite.                                      |
| Integration | Prisma repositories execute against PostgreSQL 18; lock waits, transaction rollback, uniqueness, and aggregate refund reservations are asserted.                                          |
| API         | Auth, Order, Payment, Refund, and Admin routes are exercised through Nest's real HTTP adapter and global validation/error boundaries.                                                     |
| Webhook     | Exact raw payloads are signed with Stripe's official test helper; valid, invalid, duplicate, stale, retried, and unknown events are covered across the normal and Failure Lab E2E suites. |
| End-to-end  | Product seed → order → checkout reservation → signed provider outcome → authoritative Payment/Order state is automated without browser authority.                                         |

## Required failure scenarios

|   # | Injected condition                                                      | Invariant asserted                                                                                                      | Result |
| --: | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | :----: |
|   1 | Five payment requests arrive concurrently.                              | One local Payment, one provider-side operation, and one stable idempotency key.                                         |  PASS  |
|   2 | The same signed webhook is delivered five times concurrently.           | One inbox row and one state transition; delivery count is five and four responses are duplicates.                       |  PASS  |
|   3 | A failure event older than an already processed success arrives.        | Event is retained as ignored; Payment remains `SUCCEEDED` and Order remains `PAID`.                                     |  PASS  |
|   4 | The provider accepts checkout creation but its response times out.      | Retry uses the same key and provider operation; local attempts record failed then succeeded without a duplicate charge. |  PASS  |
|   5 | The application process terminates before webhook persistence/handling. | First request commits nothing; provider retry after restart reaches `Payment=SUCCEEDED` and `Order=PAID`.               |  PASS  |
|   6 | An administrator submits the same refund request twice.                 | One local Refund, one provider Refund, one audit request, and the second response is marked reused.                     |  PASS  |
|   7 | Two 75% partial refunds race for the same payment.                      | One succeeds, one returns `409 REFUND_AMOUNT_EXCEEDED`, and reserved total never exceeds the payment.                   |  PASS  |
|   8 | PostgreSQL rejects the Order write after the Payment write begins.      | The entire webhook transaction and inbox row roll back; clean replay updates Payment and Order together.                |  PASS  |
|   9 | A forged Stripe signature accompanies a valid-looking event.            | API returns `400 WEBHOOK_SIGNATURE_INVALID`; no inbox or business state changes.                                        |  PASS  |
|  10 | An authenticated USER calls the administrator refund route.             | API returns `403 AUTH_FORBIDDEN`; no Refund is created.                                                                 |  PASS  |

## Determinism and fault injection

- Checkout and refund gateways keep provider operations in maps keyed by the
  exact idempotency key supplied by production services.
- A 20 ms checkout delay makes the five-click race overlap while the
  PostgreSQL advisory lock controls local reservation.
- The timeout gateway stores its provider result before throwing, modeling an
  accepted request whose response was lost.
- The process-restart experiment starts a second Nest application whose
  repository throws before persistence, closes it, then replays through the
  normal application.
- The atomicity experiment installs a test-scoped PostgreSQL check constraint
  that rejects only the selected Order's `PAID` update. Cleanup drops it in a
  `finally` block and again at suite teardown.
- Test data uses a run-specific email/event prefix and tracked Order IDs, then
  removes only those records.

## Reproduction

With PostgreSQL running and the ignored API environment file configured:

```powershell
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:failure-lab
```

To run the normal database-backed API E2E suite and Failure Lab together:

```powershell
pnpm test:e2e
```

The timeout, simulated restart, and database-failure experiments intentionally
produce error log entries. Acceptance is determined by the final Jest status
and the state assertions, not by the absence of those expected logs.

## Latest local evidence

```text
Command:      pnpm test:failure-lab
Test suites:  1 passed, 1 total
Tests:        10 passed, 10 total
Time:         4.056 s
Result:       PASS

Repeat gate:  3 consecutive runs
Tests:        30 passed, 30 total
Result:       PASS

Command:      pnpm test:e2e
Test suites:  2 passed, 2 total
Tests:        21 passed, 21 total
Time:         5.46 s
Result:       PASS
```

The committed implementation passed GitHub Actions run `31621486654` in 1m44s,
including PostgreSQL migration/seed, the combined E2E suite, and production
builds.
