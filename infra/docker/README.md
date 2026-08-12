# Docker infrastructure

Docker Compose is defined at the repository root so all workspace packages are
available to both application build contexts.

- PostgreSQL and Redis data persist in dedicated named volumes. Redis uses AOF
  with `appendfsync everysec` so BullMQ jobs survive a container restart.
- The API waits for PostgreSQL and Redis health, applies committed Prisma
  migrations, and runs the idempotent admin/product seed before starting.
- The web image receives the browser-visible API base URL as a build argument.
- The worker consumes verified webhook jobs from BullMQ with bounded exponential retries.
- Provider credentials arrive only through runtime environment; no credential
  is copied into an image layer. The worker receives only PayPal OAuth values
  required for approved-order capture, not Stripe or webhook signing secrets.
- Both application Dockerfiles share a locked BuildKit pnpm cache and use bounded
  registry retries so interrupted downloads are recoverable.

On the current Windows development machine, Docker Desktop's data disk remains
on C, so local Stage 8 Redis acceptance instead uses the `PayFlowRedis` WSL
distribution installed at `D:\WSL\PayFlowRedis`. This is a workstation storage
choice only; Compose remains the portable CI/deployment definition.
