# Stage 8 — PayPal + Queue acceptance record

Date: 2026-08-13

Status: Acceptance in progress

Next stage: Stage 9 is blocked until every item in section 9 passes

## 1. Stage objective

Implement only Stage 8 from the PayFlow specification: add PayPal through the
Stage 7 provider contract, persist and enqueue verified provider events, process
business effects in a BullMQ worker, and make bounded retry/final failure
observable. Do not introduce the Stage 9 outbox, ledger, or reconciliation.

## 2. Added and changed boundaries

```text
packages/payment-core/**       Provider registry + retryable error semantics
packages/payment-paypal/**     PayPal Sandbox Orders/capture/refund/webhooks
packages/payment-domain/**     Shared state machines + webhook event projection
packages/payment-queue/**      BullMQ queue, worker factory, snapshots, retry test
packages/payment-stripe/**     Current Stripe API mapping retained
apps/api/src/providers/**      Stripe + PayPal composition
apps/api/src/webhooks/**       Verify, persist, dedupe, enqueue, return
apps/api/src/queue/**          NestJS BullMQ facade
apps/api/src/admin/**          Queue operations endpoint
apps/api/test/stage-8.e2e-spec.ts
apps/worker/**                 Standalone webhook processor
apps/web/**                    Provider selector + queue operations UI
packages/database/prisma/migrations/20260813160000_stage_8_paypal_queue/**
docker-compose.yml
.github/workflows/ci.yml
```

## 3. Key design decisions

- One `PaymentProviderRegistry` routes create/query/capture/cancel/refund and
  webhook verification for both Stripe and PayPal.
- Provider choice is persisted on Payment. An active checkout cannot be changed
  to the other provider.
- PayPal uses Sandbox Orders v2, exact decimal/minor-unit conversion,
  `PayPal-Request-Id`, OAuth token caching, and the official webhook verification
  endpoint.
- Webhook HTTP handling ends after exact-byte verification, PostgreSQL inbox
  persistence/deduplication, BullMQ enqueue, and queue metadata persistence.
- The worker applies the shared domain projection. Five total attempts use
  exponential backoff; deterministic failures are unrecoverable after attempt 1.
- PostgreSQL is authoritative. Redis is queue transport and retained operations
  telemetry only.
- The Stage 8 failed-job retention surface is the current dead-letter concept;
  a separate outbox/reconciliation pipeline belongs to Stage 9.

## 4. Database migration

Migration `20260813160000_stage_8_paypal_queue`:

- adds `PAYPAL` to `PaymentProvider`;
- stores normalized action, provider occurrence time, queue job/time, processing
  attempt/start metadata, and safe failure details on `webhook_events`;
- adds a partial unique index allowing at most one successful/refunded Payment
  per Order across providers.

Migration `20260813170000_stage_8_provider_scoped_webhook_identity` replaces
the Stage 4 global event-ID uniqueness rule with the multi-provider composite
key `(provider, provider_event_id)`. A Stripe event and PayPal event may use the
same external ID without being treated as duplicates.

## 5. Runtime and storage

Compose now defines PostgreSQL 18, Redis 8.8 with AOF, API, worker, and web.
For this workstation, source/dependencies remain under `D:\Projects\PayFlow`,
the pnpm store is on D, and Redis 8.8 runs from the D-backed
`D:\WSL\PayFlowRedis` distribution to avoid further Docker C-drive growth.

## 6. Implemented acceptance scenarios

- Stripe and PayPal call the same `POST /payments/checkout-session` endpoint.
- A same-order provider switch is rejected after active reservation.
- Stripe signed normalized event is persisted, queued, and processed by worker.
- PayPal approved-order event invokes idempotent capture in the worker.
- The first simulated PayPal capture times out; BullMQ retries and succeeds.
- PostgreSQL and ADMIN queue views both expose two processing attempts.
- Permanent integrity/state failures stop after one attempt and remain visible.
- Real Stripe Test creates a hosted `checkout.stripe.com` session and same-key
  replay returns the same Session with one provider call.

The PayPal E2E gateway uses deterministic, official-shaped Sandbox responses so
CI can reproduce retry timing. A real external PayPal Sandbox checkout remains
part of the final gate and requires local Sandbox credentials.

## 7. Security and provider compatibility

- Real secrets are stored only in ignored environment files; tracked files are
  scanned by `pnpm secrets:scan` locally, in pre-commit, and in GitHub Actions.
- Worker receives only PayPal Sandbox OAuth values required for capture;
  Stripe and provider webhook-verification secrets remain in the API process.
- Live Stripe and PayPal configuration is rejected.
- Stripe Node 22.5.0 is the current package release and uses API
  `2026-07-29.dahlia`; Checkout includes `integration_identifier`, omits
  `payment_method_types`, and keeps hosted Checkout.
- Stripe and PayPal webhooks verify before persistence. Provider secrets,
  authorization values, and signatures are never logged.

## 8. Verification commands

```powershell
pnpm format:check
pnpm secrets:scan
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate:deploy
pnpm db:seed
$env:RUN_REDIS_INTEGRATION = 'true'
pnpm test:e2e
pnpm --filter @payflow/payment-queue test
pnpm build
docker compose config
```

Current local result:

```text
format + tracked/untracked secret scan      PASS
monorepo lint + typecheck                   PASS
API unit tests                              PASS (12 suites, 50 tests)
Stripe adapter tests                        PASS (4 suites, 12 tests)
PayPal adapter tests                        PASS (2 suites, 4 tests)
database-backed API/Failure Lab/Stage 8 E2E PASS (3 suites, 22 tests)
real Redis/BullMQ retry integration         PASS (1 suite, 1 test)
database migration deploy/status            PASS (9 migrations, up to date)
Next.js/NestJS/worker/package builds         PASS
desktop + 390px browser QA                  PASS
real Stripe Test hosted Checkout            PASS (API 2026-07-29.dahlia)
```

## 9. Acceptance checklist

- [x] Stripe and PayPal implement one provider-neutral business interface.
- [x] API verifies and durably receives events before enqueue/`2xx`.
- [x] Worker, Redis, and BullMQ are separate Stage 8 runtime boundaries.
- [x] Transient failure retries exponentially with a maximum of five attempts.
- [x] Permanent deterministic failure does not blindly retry.
- [x] Retry/final failure is observable in PostgreSQL and ADMIN queue UI/API.
- [x] Existing Order/Payment/Refund state machines and earlier gates remain.
- [x] No Stage 9 outbox, ledger, or reconciliation was introduced early.
- [x] Full local static, unit, database E2E, migration, and build gate passes.
- [ ] Real external PayPal Sandbox create/approve/capture path passes.
- [ ] GitHub Actions passes the committed Stage 8 implementation.

## 10. Phase gate

Stage 8 is not yet accepted. Stage 9 must not start until the two unchecked
items above are satisfied and the final evidence is committed.
