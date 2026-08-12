# Stage 2 — Order acceptance record

Date: 2026-08-12  
Status: Accepted  
Next stage: Stage 3 accepted

## 1. Stage objective

Implement only Stage 2 from the PayFlow specification: cart submission,
server-side amount recalculation, immutable order-item snapshots, owned order
list/detail reads, and cancellation of unpaid orders. Stripe, payment records,
webhooks, refunds, and admin business operations remain outside this stage.

## 2. Added and changed areas

```text
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20260812220000_stage_2_orders/migration.sql
packages/database/src/index.ts

apps/api/src/orders/**
apps/api/src/app.module.ts
apps/api/src/app.service.ts
apps/api/test/app.e2e-spec.ts

apps/web/src/app/cart/**
apps/web/src/app/orders/**
apps/web/src/components/cart-*.tsx
apps/web/src/components/order-*.tsx
apps/web/src/components/add-to-cart-button.tsx
apps/web/src/components/product-catalog.tsx
apps/web/src/components/product-detail.tsx
apps/web/src/components/site-header.tsx
apps/web/src/lib/api.ts

docs/adr/0005-server-authoritative-orders.md
docs/architecture.md
docs/design/stage-2-order-design-system.md
docs/stages/stage-2.md
README.md
```

Generated Prisma client files and local `.codex-review` artifacts are ignored.

## 3. Key design

- The request DTO contains only `productId` and `quantity`; global whitelist
  validation rejects a client-supplied amount.
- Duplicate product IDs are aggregated, then active products and current prices
  are loaded from PostgreSQL inside a serializable order transaction.
- Order and item amounts use integer minor units with overflow checks. Missing,
  inactive, mixed-currency, over-stock, and oversized requests fail explicitly.
- Order items persist SKU, name, unit-price, quantity, and line-total snapshots.
- All customer queries include `user_id`; a foreign order is indistinguishable
  from a missing order at the HTTP boundary.
- Status updates use a tested transition function. Cancellation is an atomic
  conditional update from `PENDING_PAYMENT` to `CANCELLED`.

## 4. Migration

`20260812220000_stage_2_orders` creates the complete specified Order status enum,
`orders`, and `order_items`, with ownership/product foreign keys, lookup indexes,
and checks for currency, amount, quantity, line arithmetic, and current Stage 2
total equality. Migration deploy succeeds against PostgreSQL 18.

## 5. API and web behavior

| Method | Path                 | Access         | Behavior                          |
| ------ | -------------------- | -------------- | --------------------------------- |
| POST   | `/orders`            | USER/ADMIN JWT | Reprice cart and create snapshots |
| GET    | `/orders`            | USER/ADMIN JWT | List only the subject's orders    |
| GET    | `/orders/:id`        | USER/ADMIN JWT | Read only an owned order          |
| POST   | `/orders/:id/cancel` | USER/ADMIN JWT | Cancel only a pending owned order |

The web application adds cart state, quantity controls, server-order creation,
order history, order detail, and cancellation while preserving the Stage 1
design system and permission boundaries.

## 6. Commands and results

```text
pnpm db:generate                 PASS
pnpm format                      PASS
pnpm lint                        PASS
pnpm typecheck                   PASS
pnpm test                        PASS (7 suites, 23 tests)
pnpm build                       PASS (web, API, database, shared)
pnpm db:migrate:deploy           PASS (Stage 2 migration applied)
pnpm db:seed                     PASS (1 ADMIN, 4 products)
pnpm test:e2e                    PASS (1 suite, 3 acceptance tests)
browser functional checks       PASS (21 checks)
```

The database-backed E2E test proves that an injected price is rejected, an
accepted order totals `1999 × 2 = 3998` from the database, snapshots survive a
later product name/price edit, the owner can list/read the order, another user
receives 404, pending cancellation succeeds, and repeated cancellation returns
the expected state-transition conflict.

Browser acceptance proves registration, add to cart, authenticated creation,
server-total rendering, cancellation, history reflection, keyboard skip-link
behavior, four responsive widths, and zero console/runtime errors. The in-app
browser runtime was unavailable because its host kernel-assets path was missing;
the bundled Playwright Chromium ran the equivalent checks. Screenshots are
stored under `docs/design`.

## 7. Known issues / TODO

- Stock is checked but not reserved or decremented. Fulfillment inventory design
  is outside the Stage 2 specification.
- Browser cart product display data can be stale; this is safe because accepted
  snapshots and totals always come from the API's transaction.
- Payment creation and Checkout Session behavior begin only in Stage 3.
- Sandbox secrets still must be overridden in persistent/shared environments.

## 8. Acceptance checklist

- [x] Client amount injection cannot affect an accepted order.
- [x] Every accepted unit, line, subtotal, and total amount is server calculated.
- [x] Item snapshots remain stable after a product edit.
- [x] Order list/detail and cancellation enforce ownership.
- [x] Only pending orders can be cancelled through an explicit transition.
- [x] Order plus items are atomic and database constraints preserve invariants.
- [x] Cart/order UI includes loading, error, empty, permission, and responsive
      states.
- [x] Format, lint, typecheck, unit, build, migration, seed, E2E, keyboard,
      viewport, and browser-runtime gates pass.

## 9. Phase gate

Stage 2 passed every acceptance criterion in the implementation specification.
Stage 3 is now accepted. This does not alter Stage 2's accepted status.
