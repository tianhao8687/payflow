# PayFlow

PayFlow is a full-stack payment-system portfolio project implemented one
acceptance-gated stage at a time from the accompanying Codex implementation
specification.

> Current delivery: **Stage 1 — Auth + Product (accepted)**. Orders, payment
> collection, webhooks, refunds, and the Stage 5 admin business console remain
> intentionally unimplemented.

## Stage 1 architecture

```mermaid
flowchart LR
  Browser[Next.js web :3000] -->|public reads| Products[NestJS products API]
  Browser -->|register / login| Auth[NestJS auth API]
  Browser -->|Bearer JWT| Protected[Protected API boundary]
  Protected --> RBAC{USER or ADMIN}
  Auth --> DB[(PostgreSQL :5432)]
  Products --> DB
  RBAC --> DB
  Auth --> Docs[OpenAPI /docs]
```

The V1 boundary remains a modular monolith. PostgreSQL is the source of truth,
Prisma owns schema and migrations, passwords use bcrypt cost 12, and the API—not
the browser—enforces authentication and roles. Product prices are integer minor
units; floating-point money is forbidden.

## Requirements

- Node.js 20.9 or newer (verified with Node 24)
- pnpm 11.16.0
- Docker Desktop with Docker Compose v2

## Start everything with Docker

For a disposable local sandbox, the Compose defaults are sufficient:

```powershell
docker compose up --build --wait
```

Override `JWT_SECRET`, `PAYFLOW_ADMIN_EMAIL`, and `PAYFLOW_ADMIN_PASSWORD` in a
local `.env` before using a persistent environment. The API applies committed
migrations and runs the idempotent Stage 1 seed before it starts.

If port 5432 is already occupied, keep the container port unchanged and override
only the host port:

```powershell
$env:POSTGRES_PORT = '55432'
docker compose up --build --wait
```

Docker Desktop Buildx can reject non-ASCII Windows workspace paths with an
`x-docker-expose-session-sharedkey` error. If that occurs, run the command from
an ASCII-only clone path or an ASCII-only directory junction targeting this
repository. This is a Docker build-transport limitation; repository paths do
not need to change.

Services and interfaces:

- Web catalog: <http://localhost:3000>
- Registration: <http://localhost:3000/register>
- Login: <http://localhost:3000/login>
- API information: <http://localhost:4000>
- API health: <http://localhost:4000/health>
- OpenAPI UI: <http://localhost:4000/docs>
- OpenAPI JSON: <http://localhost:4000/openapi.json>

Stop services without deleting database data:

```powershell
docker compose down
```

## Stage 1 API

| Method | Path             | Access | Purpose                           |
| ------ | ---------------- | ------ | --------------------------------- |
| POST   | `/auth/register` | Public | Create a USER and issue a JWT     |
| POST   | `/auth/login`    | Public | Verify credentials and issue JWT  |
| GET    | `/auth/me`       | JWT    | Return the safe current-user DTO  |
| GET    | `/products`      | Public | List active products              |
| GET    | `/products/:id`  | Public | Read one active product           |
| GET    | `/admin/profile` | ADMIN  | Verify the administrator boundary |

Public registration cannot choose a role. The `/admin/profile` route is a Stage
1 RBAC verifier, not the Stage 5 admin business console.

## Local development

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Set the database, JWT, and seed variables from the example files in the current
shell before migration, seed, or API commands. Real `.env` files are ignored by
Git.

## Quality gates

Run static checks, unit tests, and production builds:

```powershell
pnpm run ci
```

Run the database-backed Stage 1 acceptance suite after migration and seed:

```powershell
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:e2e
```

The GitHub Actions workflow starts PostgreSQL 18 and performs both groups. Full
evidence is recorded in [`docs/stages/stage-1.md`](docs/stages/stage-1.md).

## Workspace layout

```text
apps/
  web/        Next.js 16 App Router and Tailwind CSS
  api/        NestJS 11 modular-monolith REST API and Swagger
packages/
  database/   Prisma 7 schema, migrations, seed, generated client boundary
  shared/     Framework-neutral shared contracts
docs/
  adr/        Architecture decision records
  design/     Stage-scoped visual specifications and QA captures
infra/
  docker/     Container notes
```

## Framework compatibility notes

Prisma 7 moves connection configuration to `prisma.config.ts`, requires an
explicit generated-client output and driver adapter, and runs seeds only through
an explicit `prisma db seed`. This repository follows those official APIs with
`@prisma/adapter-pg` and `migrations.seed`. Next.js route-aware helpers are
generated with `next typegen` before standalone TypeScript checks.

## Safety boundary

PayFlow is sandbox-only. No live payment credentials or real funds belong in
this project, and the application must never store card numbers or CVC values.
