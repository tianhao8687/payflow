# ADR 0001: pnpm workspace and modular-monolith V1

- Status: Accepted
- Stage: 0

## Context

PayFlow requires independently runnable Next.js and NestJS applications while
keeping shared database and contract code in one repository. V1 must not be
prematurely split into microservices.

## Decision

Use a pnpm workspace with `apps/web`, `apps/api`, `packages/database`, and
`packages/shared`. NestJS is the V1 modular monolith and remains the sole
business-rule boundary. Future worker and payment-provider packages are added
only in their scheduled stages.

## Consequences

- One lockfile and one CI gate cover the repository.
- Workspace dependencies keep boundaries explicit without a network boundary.
- Future V2 extraction has package seams but no premature operational cost.
