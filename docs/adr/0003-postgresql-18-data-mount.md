# ADR 0003: PostgreSQL 18 data-volume mount

- Status: Accepted
- Date: 2026-08-12

## Context

The official PostgreSQL 18 container stores clusters in major-version-specific
subdirectories below `/var/lib/postgresql`. Mounting a volume directly at the
legacy `/var/lib/postgresql/data` path is rejected by the image at startup.

## Decision

Mount the Compose-managed `payflow_postgres_data` volume at
`/var/lib/postgresql`.

## Consequences

- PostgreSQL remains the system of record required by the implementation guide.
- Future major-version upgrades can use the layout expected by the official
  image.
- This is a Stage 0 infrastructure compatibility adjustment only; no domain
  model or phase sequencing changes are introduced.
