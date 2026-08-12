# ADR 0002: Prisma 7 PostgreSQL driver adapter

- Status: Accepted
- Stage: 0

## Context

The implementation specification names Prisma but predates Prisma 7's current
connection API. Prisma 7 moves the datasource URL to `prisma.config.ts`, makes
the generated-client output explicit, and requires a driver adapter.

## Decision

Keep Prisma and PostgreSQL, use the `prisma-client` generator with CommonJS
output for the NestJS package, and construct the client with
`@prisma/adapter-pg`.

## Consequences

- The core technology stack and domain plan remain unchanged.
- Configuration follows the installed 7.9.1 TypeScript API.
- Generated client files remain untracked and are reproduced by
  `pnpm db:generate` in local, CI, and Docker workflows.
