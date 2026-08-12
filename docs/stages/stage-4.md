# Stage 4 — Webhook acceptance record

Date: 2026-08-13

Status: Accepted

Next stage: Stage 5 implemented on 2026-08-13

## 1. Stage objective

Implement only Stage 4 from the PayFlow specification: exact raw-body Stripe
signature verification, durable event persistence, database-backed duplicate
suppression, explicit state-machine updates, and atomic Payment/Order success.

## 2. Added and changed areas

```text
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20260812234500_stage_4_webhooks/
packages/database/src/index.ts

apps/api/src/webhooks/**
apps/api/src/main.ts
apps/api/src/config/**
apps/api/test/**

docs/adr/0007-transactional-stripe-webhook-inbox.md
docs/payment-flow.md
docs/webhook-design.md
docs/stages/stage-4.md
README.md
docker-compose.yml
```

## 3. Key design decisions

- NestJS retains exact request bytes with `rawBody: true`; Stripe's official SDK
  verifies those bytes before persistence or business logic.
- `provider_event_id` has a database unique index. Event advisory locking makes
  concurrent repeats converge, while the unique index is the final defense.
- Verified payloads are stored as JSONB with receive/process timestamps and a
  `RECEIVED`, `PROCESSED`, `IGNORED`, or `FAILED` lifecycle.
- The event mapper recognizes Checkout and PaymentIntent outcomes. Unknown or
  non-PayFlow signed events are persisted and acknowledged as ignored.
- Amount, currency, metadata, provider IDs, and sandbox mode are validated
  before explicit Payment and Order transitions.
- Event result, Payment success, and Order paid state commit in one locked
  transaction. Order advisory and row locks prevent races across different
  events and cancellation. Stage 5 refined isolation to `READ COMMITTED` after
  concurrent delivery testing; ADR 0008 records why.
- Success/refund terminal states cannot move backward when an older failure or
  processing event arrives.

## 4. Actual code behavior

| Input                                        | Result                                            |
| -------------------------------------------- | ------------------------------------------------- |
| Missing/mutated signature                    | `400`; no persistence or business mutation        |
| Missing webhook configuration                | `503`; fail closed                                |
| First valid successful PayFlow Event         | One event row; Payment success + Order paid       |
| Same provider Event delivered again          | Stored result returned; no reprocessing           |
| Valid unknown/unrelated Event                | Persisted `IGNORED`; `200`                        |
| Older failure after successful payment       | Persisted `IGNORED`; no status regression         |
| Valid signature with amount/ID inconsistency | Persisted `FAILED`; non-2xx; no business mutation |

## 5. Database migration

`20260812234500_stage_4_webhooks` creates `WebhookEventStatus` and
`webhook_events` with the exact provider ID/type, JSONB payload, lifecycle, and
timestamps required by the specification. `provider_event_id` is unique;
provider/time and status/time indexes support later administration and worker
polling.

## 6. Local run commands

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm dev
stripe listen --forward-to localhost:4000/webhooks/stripe
```

Set the CLI listener's `whsec_...` value as `STRIPE_WEBHOOK_SECRET` in the
ignored local environment before restarting the API.

## 7. Test commands and current results

```text
pnpm db:migrate:deploy           PASS (Stage 4 migration applied)
pnpm --filter @payflow/api test  PASS (13 suites, 48 tests)
pnpm test:e2e                    PASS (1 suite, 9 tests)
pnpm lint                        PASS
pnpm typecheck                   PASS
pnpm test                        PASS (13 suites, 48 tests)
pnpm build                       PASS (web, API, database, shared)
production HTTP/OpenAPI          PASS (Stage 4 route and version)
browser responsive checks       PASS (320/768/1440, no errors/overflow)
GitHub Actions                   PASS (run 31616625143, 1m35s)
```

The E2E route is the real NestJS raw-body endpoint backed by PostgreSQL. Stripe's
official signing helper signs pretty-printed JSON bytes. Tests prove a forged
secret creates no row, five concurrent copies create one row and one state
transition, stale failure cannot regress success, an unknown event is ignored,
and a signed amount mismatch cannot change Payment or Order.

## 8. Known issues / TODO

- Stripe CLI forwarding is an operator workflow and is not required on GitHub
  runners; CI uses official local signature construction.
- Refund webhook mapping was delivered in Stage 5.
- Queue-based asynchronous processing remains Stage 8.

## 9. Acceptance checklist

- [x] Raw Body is preserved and its exact bytes are verified.
- [x] Forged signatures fail before persistence or state mutation.
- [x] Verified events persist in the event table as JSONB.
- [x] `provider_event_id` has database uniqueness and concurrent deduplication.
- [x] A legitimate signed success updates Payment and Order atomically.
- [x] Five duplicate deliveries do not reprocess the event.
- [x] Out-of-order and unknown events cannot regress business state.
- [x] Final lint, typecheck, unit, E2E, and production build gates pass.
- [x] GitHub Actions passes the committed Stage 4 implementation.

## 10. Phase gate

Stage 4 passed every acceptance criterion in the implementation specification.
Stage 5 may now begin.
