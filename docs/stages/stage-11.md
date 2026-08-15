# Stage 11 — Alipay PC web sandbox and durable Inbox

Date: 2026-08-15

## Delivered boundary

Stage 11 adds an official-SDK Alipay adapter without introducing Alipay types
into NestJS business services or the database domain. The current executable
scope includes:

- CNY-only `alipay.trade.page.pay` with a stable Payment UUID as
  `out_trade_no`, exact gateway-host validation, integer minor-unit conversion,
  and no fabricated `trade_no` or checkout-session ID;
- provider-neutral checkout URL/expiry/merchant-reference contracts plus
  reference-based query and close support for pre-transaction checkouts;
- official `checkNotifySignV2` form verification, app/seller/reference/amount
  checks, minimized payload persistence, SHA-256 payload hash, and exact
  plain-text `success` after the PostgreSQL Inbox commit;
- Redis-independent acknowledgement with a leased Inbox Dispatcher and
  deterministic BullMQ job IDs shared by Stripe, PayPal, and Alipay;
- payment query/close recovery, terminal-state protection, Alipay refund plus
  refund query using one stable `out_request_no`, and a three-second mutation
  gate;
- paged reconciliation with `(updatedAt,id)` checkpoints and bounded
  concurrency, a real CNY seed fixture, Alipay Web UI selection, exact redirect
  allowlist, and capped visibility-aware result polling;
- production Swagger opt-in, expanded tracked-secret scanning, production
  dependency audit, and an exact `js-yaml` security override.

## Configuration

Alipay is disabled by default. Sandbox enablement requires
`ALIPAY_ENABLED=true`, sandbox app/seller IDs, the application private key,
either the Alipay public key or the complete certificate set, and configured
notify/return URLs. Secrets must be supplied from ignored environment files or
a secret manager; tracked examples contain no usable credentials.

Production mode additionally requires `ALIPAY_ALLOW_PRODUCTION=true`, the exact
production gateway, HTTPS callbacks, and complete certificate mode. Stage 11
acceptance is not authorization to process real funds.

## Automated evidence

- `pnpm run verify` is the canonical local quality gate; GitHub CI retains its
  database-backed steps and runs the same production dependency audit
  explicitly.
- Alipay adapter tests cover exact CNY conversion, stable references, host
  rejection, query/close, bounded retry, refund/query, signature/identity
  rejection, payload minimization, and disabled configuration.
- Stage 11 E2E sends five concurrent checkout requests and proves one local
  Payment/merchant reference, verifies an unqueued Inbox row is acknowledged,
  starts the Dispatcher/Worker, projects success, deduplicates replay, rejects
  an amount mismatch, and ignores a late `TRADE_CLOSED` regression.
- The additive migration has been deployed both over the Stage 10 database and
  through all migrations on an empty PostgreSQL database.
- Existing Stripe, PayPal, API, Failure Lab, queue, outbox, ledger,
  reconciliation, and observability suites remain regression gates.

## Intentionally deferred before real funds

- Provider-wide token buckets, circuit breakers, per-tier jittered recovery
  schedules, and production alert routing;
- Alipay daily statement download and bank-settlement three-way
  reconciliation;
- KMS/HSM key custody, rotation drills, private-network TLS, container
  hardening, MFA/step-up refund approval, and dual control;
- real Alipay sandbox credentials and human payment/refund exercises. These are
  enabled only through an explicit local secret-backed test switch.

See `docs/alipay-stage-11-plan.md` for the implementation plan and
`docs/adr/0013-durable-webhook-inbox-dispatcher.md` for the acknowledgement
semantics.
