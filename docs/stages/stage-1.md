# Stage 1 — Auth + Product acceptance record

Date: 2026-08-12  
Status: Accepted  
Next stage: Stage 2 accepted

## 1. Stage objective

Implement only Stage 1 from the PayFlow specification: user registration and
login, USER/ADMIN RBAC, the User/Role/Product data model, public read-only
product APIs, an idempotent administrator/product seed, and the corresponding
web surfaces. Orders, checkout, payments, webhooks, refunds, and the admin
business console remain outside this delivery.

## 2. Added and changed files

```text
.env.example
.github/workflows/ci.yml
README.md
docker-compose.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml

apps/api/Dockerfile
apps/api/.env.example
apps/api/package.json
apps/api/src/app.controller.ts
apps/api/src/app.module.ts
apps/api/src/app.service.ts
apps/api/src/config/environment.ts
apps/api/src/database/database.service.ts
apps/api/src/health/health.controller.ts
apps/api/src/main.ts
apps/api/src/auth/**
apps/api/src/products/**
apps/api/src/users/**
apps/api/test/app.e2e-spec.ts
apps/api/test/jest-e2e.json
apps/api/test/setup-env.ts

apps/web/Dockerfile
apps/web/src/app/account/page.tsx
apps/web/src/app/admin/page.tsx
apps/web/src/app/globals.css
apps/web/src/app/layout.tsx
apps/web/src/app/login/page.tsx
apps/web/src/app/page.tsx
apps/web/src/app/products/[id]/page.tsx
apps/web/src/app/register/page.tsx
apps/web/src/app/system/page.tsx
apps/web/src/components/account-panel.tsx
apps/web/src/components/admin-boundary.tsx
apps/web/src/components/auth-form.tsx
apps/web/src/components/auth-page-shell.tsx
apps/web/src/components/auth-provider.tsx
apps/web/src/components/product-catalog.tsx
apps/web/src/components/product-detail.tsx
apps/web/src/components/site-footer.tsx
apps/web/src/components/site-header.tsx
apps/web/src/components/readiness-rail.tsx
apps/web/src/components/system-flow.tsx
apps/web/src/lib/api.ts

packages/database/package.json
packages/database/prisma.config.ts
packages/database/prisma/schema.prisma
packages/database/prisma/seed.ts
packages/database/prisma/migrations/20260812121533_stage_1_auth_product/migration.sql
packages/database/prisma/migrations/20260812121800_stage_1_data_constraints/migration.sql
packages/database/src/index.ts
packages/database/tsconfig.seed.json
packages/shared/src/index.ts

docs/adr/0004-jwt-rbac-authentication.md
docs/architecture.md
docs/design/stage-1-catalog-desktop.png
docs/design/stage-1-catalog-mobile.png
docs/design/stage-1-design-system.md
docs/stages/stage-1.md
infra/docker/README.md
```

Generated Prisma client files are build artifacts and are not listed
individually.

## 3. Key design decisions

- The locked Next.js, NestJS, PostgreSQL, Prisma, REST/Swagger, TypeScript, and
  modular-monolith stack is unchanged.
- Authentication uses 15-minute HS256 bearer JWTs with issuer/audience checks
  and only `sub`/`role` claims. API routes are authenticated by default and
  opened only through explicit `@Public()` metadata.
- Public registration always writes `USER`; the environment-driven seed is the
  only Stage 1 path that creates or promotes `ADMIN`.
- Passwords use bcrypt cost 12. Inputs that exceed bcrypt's 72 UTF-8 byte limit
  are rejected rather than silently truncated.
- Login and registration are limited to five attempts per minute; the API-wide
  baseline is 120 requests per minute.
- `price_amount` is an integer minor-unit value. PostgreSQL checks enforce
  nonnegative price/stock, normalized lowercase email, and uppercase
  three-letter currency.
- `/admin/profile` is the smallest server-enforced RBAC proof needed for Stage
  1. It does not pull Stage 5 admin business behavior forward.
- The frontend keeps JWTs only in tab-scoped `sessionStorage`; UI visibility is
  never treated as authorization.

## 4. Implemented code

- Auth/users Nest modules with validated DTOs, bcrypt hashing, constant-work
  invalid credential comparison, short-lived token issuance, safe user DTOs,
  duplicate-email handling, global JWT and roles guards, decorators, and
  per-route throttling.
- Product Controller/Service/Repository layers with public active-product list
  and detail reads, deterministic SKU ordering, UUID validation, and structured
  404 errors.
- Swagger bearer security and Stage 1 endpoint documentation.
- Idempotent admin and four-product seed with no password or token logging.
- Responsive catalog/detail, registration/login, account, admin-boundary, and
  system pages with loading, error, empty, missing, unauthorized, forbidden,
  and granted states.
- CI PostgreSQL service, migration/seed/E2E steps, and recoverable BuildKit pnpm
  cache for application images.

## 5. Database migration

`20260812121533_stage_1_auth_product` creates:

- `Role` enum: `USER`, `ADMIN`.
- `users`: UUID `id`, unique `email`, `password_hash`, `role`, `created_at`.
- `products`: UUID `id`, unique `sku`, `name`, integer `price_amount`,
  three-letter `currency`, `stock`, and `active`, plus an active-state index.

`20260812121800_stage_1_data_constraints` adds database checks for lowercase
email, nonnegative price and stock, and uppercase three-letter currency. All
three committed migrations, including Stage 0 bootstrap, are applied. The seed
leaves one ADMIN and four active products and is safe to rerun.

## 6. Local run commands

```powershell
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Run the full container stack with:

```powershell
docker compose up --build --wait
```

Set the database, JWT, and seed variables shown in `.env.example`. If local port
5432 is occupied, set `POSTGRES_PORT=55432` and use that host port only in the
local `DATABASE_URL`.

## 7. Tests and results

```text
pnpm run ci                           PASS
  lint                                PASS (4 workspace projects)
  typecheck                           PASS (4 workspace projects)
  unit tests                          PASS (5 suites, 11 tests)
  production builds                   PASS (web, API, database, shared)
pnpm db:migrate:deploy                PASS (3 migrations, no drift/pending work)
pnpm db:seed                          PASS (1 ADMIN, 4 active products)
pnpm test:e2e                         PASS (1 suite, 2 acceptance tests)
docker compose up -d --build --wait   PASS (3/3 services healthy)
login throttling probe                PASS (401,401,401,401,429,429)
runtime 5xx log scan                  PASS (0 unexpected 5xx errors)
```

The database-backed E2E suite proves public product list/detail reads,
registration, email normalization, role-injection rejection, duplicate-email
conflict, invalid-login rejection, protected `/auth/me`, USER denial at the
admin boundary, ADMIN access, and absence of password fields in responses.

Browser acceptance proves:

- Four seeded products and product detail are usable.
- Missing, loading, and empty catalog states render.
- Registration restores a USER session; USER receives the expected 403;
  seeded ADMIN receives 200.
- The skip link is first in keyboard order and has a visible focus indicator.
- 320, 768, 1024, and 1440 pixel viewports have no horizontal overflow.
- No unexpected console errors, page errors, failed requests, or HTTP errors.

The in-app browser runtime could not initialize because its local kernel-assets
path was missing, so the same acceptance suite ran with the bundled Playwright
Chromium. The clean desktop and mobile captures are stored in `docs/design`.

## 8. Known issues / TODO

- Docker Desktop Buildx on this Windows host still needs an ASCII-only build
  entry path when the repository path contains Chinese characters. Final
  Compose acceptance used a verified temporary directory junction, removed
  immediately afterward.
- Sandbox Compose defaults are not production secrets. Any persistent or shared
  environment must override JWT and administrator credentials.
- JWT role changes take effect on renewal or expiration; the 15-minute lifetime
  bounds the Stage 1 window. Revocation infrastructure is deferred unless a
  later approved stage requires it.
- Stage 2 order behavior is recorded separately in `stage-2.md`.

## 9. Acceptance checklist

- [x] User, Role, and Product models are migrated in PostgreSQL.
- [x] Administrator and product seed is idempotent.
- [x] Registration tests pass and cannot self-assign ADMIN.
- [x] Login tests pass with strong password hashing and sensitive-route limits.
- [x] USER and ADMIN permissions are isolated by the API.
- [x] Public product list and detail APIs are accessible.
- [x] Product prices remain integer minor units.
- [x] Catalog and auth web flows expose required loading/error/empty/permission
      states and responsive behavior.
- [x] Lint, typecheck, unit, E2E, production build, Compose health, and browser
      gates pass.

## 10. Phase gate

Stage 1 passed every acceptance criterion in the implementation specification.
Stage 2 is accepted; see `docs/stages/stage-2.md`.
