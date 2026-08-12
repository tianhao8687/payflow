# Stage 9 — Outbox + Ledger + Reconciliation acceptance record

Date: 2026-08-13

Status: Accepted

Next stage: Stage 10 may begin

## 1. Stage objective

Implement only Stage 9 from the PayFlow specification: a transactional outbox,
an enforced double-entry ledger, scheduled provider reconciliation, and an
audited administration surface. Preserve the locked technical stack, domain
model, provider adapters, and phase order.

## 2. Added and changed boundaries

```text
packages/database/prisma/migrations/20260813190000_stage_9_outbox_ledger_reconciliation/**
packages/payment-domain/src/outbox.ts
packages/payment-domain/src/reconciliation.ts
packages/payment-queue/src/index.ts
packages/payment-stripe/src/stripe.provider.ts
packages/payment-paypal/src/paypal.provider.ts
apps/worker/src/integrity-runtime.ts
apps/api/src/admin/**
apps/api/test/stage-9.e2e-spec.ts
apps/web/src/components/integrity-panel.tsx
docs/reconciliation.md
docs/adr/0011-transactional-outbox-ledger-reconciliation.md
```

## 3. Implemented acceptance scenarios

- A successful webhook transaction commits Payment/Order state and one unique
  pending OutboxEvent together.
- Re-enqueuing the same OutboxEvent UUID converges on one ledger transaction.
- Payment and refund events create opposing debit/credit pairs with zero signed
  balance.
- A deliberately one-sided transaction is rejected by PostgreSQL at commit.
- A deliberately tampered local Payment status is found as a provider
  `STATUS_MISMATCH` with both snapshots retained.
- ADMIN can inspect and idempotently resolve the issue; USER receives `403` and
  exactly one resolution audit event is written.

## 4. Local verification evidence

```text
format + lint + typecheck                       PASS
fresh database migrate + seed                   PASS (10 migrations)
Stage 9 PostgreSQL/Redis acceptance              PASS (1 suite, 1 test)
BullMQ Redis integration                         PASS (1 suite, 1 test)
full API/Failure Lab/Stage 8/Stage 9 E2E        PASS (4 suites, 23 tests)
browser QA at 320/768/1024/1440                 PASS (no page overflow/errors)
GitHub Actions                                   PASS (run 31634962310, 2m47s)
```

The PayPal adapter tests use official-shaped Sandbox responses; no external
PayPal account was contacted because credentials were not supplied. Stripe and
PayPal API compatibility decisions are documented in
`docs/reconciliation.md`.

## 5. Acceptance checklist

- [x] Payment/Order or Refund projection and outbox append share one database
      transaction.
- [x] Pending events survive queue failure windows and use deterministic queue
      identity for safe retry.
- [x] Duplicate delivery creates at most one ledger transaction.
- [x] Every committed ledger transaction has at least two entries, matching
      currencies, and zero debit-minus-credit balance.
- [x] Payment and refund entries use inverse account directions.
- [x] Scheduled reconciliation records passes, mismatches, and provider errors.
- [x] Amount, currency, status, and available provider refund totals are
      compared without fabricating unavailable data.
- [x] Deliberate payment-status divergence is discovered and retained.
- [x] Reconciliation issue reads and resolution require ADMIN and resolution is
      audited exactly once.
- [x] Responsive ADMIN Integrity UI passed browser validation.
- [x] Fresh migration/seed and complete local regression gates pass.
- [x] Final committed GitHub Actions run passes (`31634962310`).

## 6. Phase gate

Stage 9 is accepted. Transactional outbox delivery, enforced balanced ledger
transactions, deliberate mismatch discovery, audited resolution, complete local
regression gates, and GitHub Actions all pass, so Stage 10 may begin in the
prescribed sequence.
