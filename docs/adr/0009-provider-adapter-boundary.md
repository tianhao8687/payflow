# ADR 0009: Provider-neutral contract with an isolated Stripe adapter

- Status: Accepted
- Date: 2026-08-13

## Context

Through Stage 6, Checkout creation, Refund submission, Stripe signature
verification, and Stripe Event mapping lived in NestJS API modules. The code was
reliable, but business services and repositories referenced provider-specific
gateways/types. Stage 7 requires a `PaymentProvider` abstraction before PayPal
and queued orchestration are introduced.

## Decision

Create two in-process workspace packages:

- `@payflow/payment-core` defines the provider-neutral interface, capabilities,
  normalized states/actions, result types, and error contract.
- `@payflow/payment-stripe` implements that interface and is the sole production
  owner of Stripe SDK calls, provider field/status mapping, error conversion,
  and webhook verification/event mapping.

NestJS binds `StripeProvider` to the core `PAYMENT_PROVIDER` token in one global
composition module. Payments, Refunds, and Webhooks services inject the
interface. Repositories receive persisted provider identity and normalized
actions; they do not receive Stripe Event objects.

Keep all adapters in the same process. Do not introduce a microservice, runtime
provider selector, PayPal, Redis, BullMQ, or Worker in Stage 7.

## Consequences

- Business code compiles and tests without importing Stripe SDK types.
- Provider-specific status/error changes are localized to one package.
- Stable business idempotency keys and local state machines remain authoritative.
- Adapter contract tests can validate current installed Stripe TypeScript APIs.
- Stage 8 can add another implementation and selection policy without moving
  Order/Payment/Refund business rules into provider packages.
- The current persistence enum still contains only Stripe; PayPal persistence
  and selection require a Stage 8 migration and acceptance gate.
- Workspace/Docker build order now includes both provider packages before API
  compilation.

## Enforcement

Scoped ESLint restrictions reject production imports that cross the boundary.
The full unit, adapter, API E2E, Failure Lab, build, and GitHub Actions gates
must remain green.
