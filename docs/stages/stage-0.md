# Stage 0 — Bootstrap acceptance record

Date: 2026-08-12  
Status: Accepted  
Next stage: Not started

## 1. Stage objective

Establish the PayFlow monorepo with Next.js, NestJS, PostgreSQL, Prisma, Docker
Compose, ESLint, Prettier, and a GitHub Actions quality pipeline. No Stage 1
authentication or product domain code is included.

## 2. Added files

```text
.dockerignore
.editorconfig
.env.example
.github/workflows/ci.yml
.gitignore
.npmrc
.prettierignore
.prettierrc.json
README.md
docker-compose.yml
eslint.config.mjs
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json

apps/api/.env.example
apps/api/Dockerfile
apps/api/eslint.config.mjs
apps/api/nest-cli.json
apps/api/package.json
apps/api/README.md
apps/api/src/app.controller.spec.ts
apps/api/src/app.controller.ts
apps/api/src/app.module.ts
apps/api/src/app.service.ts
apps/api/src/config/environment.ts
apps/api/src/database/database.module.ts
apps/api/src/database/database.service.ts
apps/api/src/dto/app-info-response.dto.ts
apps/api/src/health/dto/health-response.dto.ts
apps/api/src/health/health.controller.ts
apps/api/src/health/health.module.ts
apps/api/src/health/health.service.spec.ts
apps/api/src/health/health.service.ts
apps/api/src/http/api-exception.filter.ts
apps/api/src/http/request-id.middleware.ts
apps/api/src/main.ts
apps/api/test/app.e2e-spec.ts
apps/api/test/jest-e2e.json
apps/api/tsconfig.build.json
apps/api/tsconfig.json

apps/web/.env.example
apps/web/AGENTS.md
apps/web/CLAUDE.md
apps/web/Dockerfile
apps/web/eslint.config.mjs
apps/web/next.config.ts
apps/web/package.json
apps/web/postcss.config.mjs
apps/web/README.md
apps/web/src/app/globals.css
apps/web/src/app/layout.tsx
apps/web/src/app/page.tsx
apps/web/src/components/brand-mark.tsx
apps/web/src/components/readiness-rail.tsx
apps/web/src/components/system-flow.tsx
apps/web/src/components/system-icons.tsx
apps/web/tsconfig.json

packages/database/package.json
packages/database/prisma.config.ts
packages/database/prisma/migrations/20260812193000_bootstrap/migration.sql
packages/database/prisma/migrations/migration_lock.toml
packages/database/prisma/schema.prisma
packages/database/src/index.ts
packages/database/tsconfig.build.json
packages/database/tsconfig.json
packages/shared/package.json
packages/shared/src/index.ts
packages/shared/tsconfig.build.json
packages/shared/tsconfig.json

docs/architecture.md
docs/adr/0001-pnpm-modular-monolith.md
docs/adr/0002-prisma-7-driver-adapter.md
docs/adr/0003-postgresql-18-data-mount.md
docs/design/stage-0-bootstrap-concept.png
docs/design/stage-0-design-system.md
docs/design/stage-0-implementation-desktop.png
docs/design/stage-0-implementation-mobile.png
docs/stages/stage-0.md
infra/docker/README.md
```

## 3. Key design decisions

- pnpm workspaces keep the V1 architecture as a modular monolith with explicit
  web, API, database, and shared package boundaries.
- PostgreSQL remains the system of record. Prisma owns schema evolution.
- Prisma 7 compatibility is isolated in the database package: connection
  configuration lives in `prisma.config.ts`, the client uses an explicit output,
  and runtime access uses `@prisma/adapter-pg`.
- PostgreSQL 18's official container layout requires the persistent volume at
  `/var/lib/postgresql`, recorded in ADR 0003.
- Stage 0 contains no domain tables. Authentication, products, orders, payments,
  refunds, provider adapters, queues, ledgers, and reconciliation remain gated
  behind their specified later stages.

## 4. Implemented code

- Responsive Next.js readiness page with original SVG icons and a live API health
  probe.
- NestJS REST bootstrap with validated environment configuration, Swagger UI,
  OpenAPI JSON, request IDs, unified error responses, database lifecycle, and a
  database-backed `/health` endpoint.
- Docker images and dependency-ordered Compose health checks for PostgreSQL,
  API, and web.
- Repository-wide linting, formatting, type checking, unit tests, builds, and a
  GitHub Actions workflow.

## 5. Database migration

`20260812193000_bootstrap` is an intentionally domain-empty bootstrap migration.
It establishes verified Prisma migration history without implementing Stage 1
models early. `prisma migrate deploy` applied it successfully and PostgreSQL
reported it as complete in `_prisma_migrations`.

## 6. Local run commands

```powershell
pnpm install
docker compose up --build
```

For local process development, use the commands in the root README. Docker
Desktop on Windows may require an ASCII-only clone or directory junction when
the repository path contains non-ASCII characters.

## 7. Tests and results

```text
pnpm run format:check                 PASS
pnpm run ci                           PASS
  lint                                PASS (4 workspace projects)
  typecheck                           PASS (4 workspace projects)
  unit tests                          PASS (2 suites, 2 tests)
  production builds                   PASS (web, API, database, shared)
pnpm --filter @payflow/api test:e2e   PASS (1 suite, 1 test)
docker compose up -d --wait           PASS (3/3 services healthy)
GET /                                 PASS (200)
GET /health                           PASS (200, database=up, x-request-id)
GET /openapi.json                     PASS (/, /health documented)
GET web /                             PASS (200)
Prisma migration query                PASS (bootstrap migration applied)
```

Visual verification used Playwright after the in-app browser runtime could not
initialize on this Windows host. The implementation was tested at 1536×1024 and
390×844. Both viewports returned 200, showed the live web/API/database states,
had no horizontal overflow, broken images, console errors, page errors, or
failed requests, and exposed no interactive target below 44px. The CTA scrolled
to `#system-readiness` successfully.

Concept-to-implementation comparison:

| Area                                             | Result                               |
| ------------------------------------------------ | ------------------------------------ |
| Above-the-fold heading, supporting copy, and CTA | Exact text match                     |
| Two-column desktop composition                   | Matched at 1536×1024                 |
| Cobalt, teal, black, white palette               | Matched                              |
| Web → API → database → future sandbox flow       | Matched; statuses use live health    |
| Readiness rail and sandbox footer                | Matched                              |
| Original neutral icon language                   | Matched; no third-party trademarks   |
| Mobile reflow                                    | Verified at 390×844 with no overflow |

The concept was generated with the built-in image-generation tool from a
desktop UI mockup prompt specifying the exact Stage 0 copy, a white/near-black,
cobalt-and-teal Swiss editorial direction, an open two-column hero, a system
flow, and a readiness rail with no later-stage features or trademarks.

## 8. Known issues / TODO

- Docker Desktop Buildx can reject non-ASCII Windows workspace paths. The full
  Compose acceptance run was completed through an ASCII directory junction
  pointing at this repository; the workaround is documented in the README.
- The in-app browser runtime failed before it could attach on this host, so the
  equivalent browser acceptance suite used bundled Playwright.
- Stage 1 work is intentionally absent and remains the next gated task.

## 9. Acceptance checklist

- [x] Monorepo established.
- [x] Next.js web application runs.
- [x] NestJS API runs.
- [x] PostgreSQL and Prisma run with an applied migration.
- [x] `docker compose up` starts the dependency-ordered stack; all services are
      healthy.
- [x] ESLint and Prettier pass.
- [x] CI-required lint, typecheck, and build pass.
- [x] Unit and Stage 0 API end-to-end tests pass.
- [x] GitHub Actions base pipeline is present.

## 10. Phase gate

Stage 0 passed all of its acceptance criteria. Stage 1 has not been started.
