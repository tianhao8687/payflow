# Stage 12 — Webhook retry and identity hardening

Date: 2026-08-15

## Delivered boundary

Stage 12 keeps the Stage 11 Alipay and durable-Inbox architecture and hardens
its failure behavior:

- persisted due-time scheduling for Inbox dispatch;
- atomic attempt claims, exponential retry, deterministic jitter, and a
  fifteen-minute cap without silently discarding acknowledged events;
- canonical SHA-256 fingerprints for verified Provider event identity;
- explicit rejection and metrics for an event ID reused with different content;
- ADMIN webhook response field whitelisting, removing payload/action/hash data;
- due-time database indexing plus safe retry diagnostics and metrics.

The additive migration is
`20260815230000_stage_12_webhook_retry_integrity`. It gives existing rows an
immediately due schedule and leaves historical fingerprints nullable for safe
lazy binding.

## Open-source comparison

The design intentionally adopts the small common core of Hyperswitch's
scheduled Process Tracker, Kill Bill's future-notification Janitor, and Saleor's
bounded exponential webhook retries. PayFlow does not import their general job
frameworks: PostgreSQL Inbox rows remain the only scheduling model required by
this modular monolith. See ADR 0014 for source links and tradeoffs.

## Acceptance evidence

- Stage 11 E2E simulates a Redis dispatch failure, proves the row is not selected
  before `next_dispatch_at`, then advances the schedule and proves Worker
  recovery.
- The same signed Alipay notification remains a normal duplicate, while a valid
  notification reusing its `notify_id` with a different `trade_no` returns 400
  and leaves the original delivery count unchanged.
- The full API E2E verifies that ADMIN webhook responses omit `payloadJson`,
  `actionJson`, `payloadHash`, and `eventFingerprint`.
- The observability contract checks both new Prometheus metric names.
- `pnpm run verify`, all migrations on an empty PostgreSQL database, the full
  PostgreSQL/Redis API E2E suite, and the real Redis queue integration remain the
  release gates.

## Intentionally deferred

- a manual Inbox replay/hold console with operator reason and audit trail;
- per-provider or per-merchant retry policies;
- production paging routes and SLO-calibrated thresholds;
- Alipay daily statement and bank-settlement three-way reconciliation;
- KMS/HSM custody, private-network TLS, multi-region database recovery, and
  real-funds operational approval.

## Validation result

- `pnpm run verify`: PASS (format, secret scan, production audit, lint,
  typecheck, 106 unit/contract tests, and all production builds).
- Empty PostgreSQL deployment: PASS (12/12 migrations plus seed).
- PostgreSQL/Redis API E2E: PASS (6 suites, 26 tests).
- Stage 11/12 focused Inbox E2E: PASS (1 suite, 1 end-to-end scenario).
- Real Redis BullMQ integration: PASS (1 suite, 1 test).
