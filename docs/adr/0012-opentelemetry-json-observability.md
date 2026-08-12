# ADR 0012: OpenTelemetry traces/metrics with explicit JSON logs

- Status: Accepted for Stage 10 implementation
- Date: 2026-08-13

## Context

Stage 10 requires structured logs, API → database → provider → queue → worker
tracing, six exact payment metrics, and dependency-aware health without changing
the modular-monolith/domain boundaries accepted through Stage 9. The default
sandbox must remain small and start without an observability vendor account.

The OpenTelemetry JavaScript project currently marks traces and metrics stable
but logs as development. BullMQ is also a custom process boundary whose job data
does not automatically carry HTTP context.

## Decision

Create the framework-neutral `@payflow/observability` package and initialize one
NodeSDK instance at the first line of each API/worker runtime before dynamically
importing application bootstrap code.

- Instrument HTTP/Express, PostgreSQL, ioredis, and Undici with current official
  OpenTelemetry instrumentations.
- Add small manual spans at provider, reconciliation, and queue operations.
- Serialize W3C `traceparent`/`tracestate` in BullMQ job data and extract it in
  each consumer.
- Export traces over OTLP/HTTP only when configured. Use an in-process discard
  exporter otherwise, avoiding repeated connection failures in the default
  sandbox.
- Expose Prometheus pull endpoints independently for API and worker, bound to
  loopback at the Compose host boundary.
- Keep application logs as newline-delimited JSON with AsyncLocalStorage
  correlation and recursive secret redaction. Do not adopt the developing OTel
  logs SDK as a required runtime boundary.
- Count committed state changes, not message deliveries, for money outcomes.
  Duplicate deliveries and processing duration have their own metrics.

## Consequences

- One trace can cross HTTP, database/provider calls, Redis, and worker processes.
- The local system remains usable with five containers and no external backend.
- Metrics can be scraped directly and traces can be routed to any compatible
  OTLP/HTTP collector without provider-specific application code.
- Explicit W3C job fields are a durable queue schema concern and require
  compatibility when job formats evolve.
- The JSON logger is intentionally small; external retention/search/alerting is
  a deployment responsibility.
- The contract tests must guard redaction, exact metric names, low-cardinality
  labels, and trace continuity against SDK upgrades.
