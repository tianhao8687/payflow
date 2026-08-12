# Docker infrastructure

Docker Compose is defined at the repository root so all workspace packages are
available to both application build contexts.

- PostgreSQL data persists in the named `payflow_postgres_data` volume.
- The API waits for PostgreSQL health, applies committed Prisma migrations, and
  runs the idempotent Stage 1 admin/product seed before starting.
- The web image receives the browser-visible API base URL as a build argument.
- Both application Dockerfiles share a locked BuildKit pnpm cache and use bounded
  registry retries so interrupted downloads are recoverable.
- Redis is intentionally deferred until Stage 8.
