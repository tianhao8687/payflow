# PayFlow architecture

## Current boundary: Stage 8 accepted

Stage 8 adds a PayPal Sandbox adapter and an asynchronous BullMQ webhook worker
without changing the locked Order, Payment, Refund, or WebhookEvent domain
model. The NestJS API remains the sole HTTP/business authorization boundary;
the worker is a separate process that reuses the same provider-neutral domain
package and PostgreSQL source of truth.

```mermaid
flowchart TB
  subgraph Client[Next.js App Router]
    Catalog[Catalog and product detail]
    AuthUI[Register, login, account]
    Cart[Cart and order history/detail]
    AdminUI[Admin operations console]
  end

  subgraph API[NestJS modular monolith API]
    Auth[Auth module]
    Users[Users repository]
    Products[Products module]
    Orders[Orders module + state machine]
    Payments[Payments module + state machine]
    ProviderComposition[Provider composition module]
    Webhooks[Webhooks module]
    Refunds[Refunds module + state machine]
    Admin[Admin query module]
    Guards[JWT guard + roles guard]
    System[System and health module]
    DatabaseModule[Database module]
  end

  subgraph ProviderPackages[Provider packages]
    PaymentCore[payment-core contract]
    StripeProvider[payment-stripe adapter]
    PayPalProvider[payment-paypal adapter]
    PaymentDomain[payment-domain state projection]
    PaymentQueue[payment-queue BullMQ boundary]
  end

  Worker[Standalone webhook worker]
  Redis[(Redis / BullMQ)]

  subgraph Data
    Prisma[Prisma client boundary]
    Postgres[(PostgreSQL)]
  end

  Catalog -->|public GET| Products
  Cart -->|product IDs + quantities| Guards
  Guards --> Orders
  Guards --> Payments
  AuthUI -->|register / login| Auth
  AuthUI -->|Bearer JWT| Guards
  AdminUI -->|Bearer JWT + ADMIN| Guards
  Guards --> Admin
  Guards --> Refunds
  Guards --> Auth
  Auth --> Users
  Products --> DatabaseModule
  Orders --> DatabaseModule
  Payments --> DatabaseModule
  Payments --> PaymentCore
  Refunds --> PaymentCore
  Webhooks --> PaymentCore
  ProviderComposition --> StripeProvider
  ProviderComposition --> PayPalProvider
  PaymentCore -. implemented by .-> StripeProvider
  PaymentCore -. implemented by .-> PayPalProvider
  StripeProvider --> Stripe[Stripe Test hosted Checkout]
  PayPalProvider --> PayPal[PayPal Sandbox Orders v2]
  Stripe -->|raw Event + signature| Webhooks
  PayPal -->|raw Event + verification headers| Webhooks
  Webhooks -->|verify + durable receive| DatabaseModule
  Webhooks -->|enqueue event UUID| PaymentQueue --> Redis
  Redis --> Worker
  Worker --> PaymentDomain
  Worker --> StripeProvider
  Worker --> PayPalProvider
  PaymentDomain --> DatabaseModule
  Refunds --> DatabaseModule
  Admin --> DatabaseModule
  Users --> DatabaseModule
  System --> DatabaseModule
  DatabaseModule --> Prisma --> Postgres
```

## Locked V1 constraints

- Next.js + TypeScript with App Router for user and admin web surfaces.
- NestJS + TypeScript as the sole business-rule and authorization boundary.
- REST + OpenAPI/Swagger for public interfaces.
- PostgreSQL as system of record and Prisma for schema, migration, seed, and
  access.
- Integer minor units for money fields; floating-point money is forbidden.
- Order and Payment remain separate domain objects when their stages arrive.
- The business API remains a modular monolith. Provider/domain packages are
  shared code boundaries, and the Stage 8 worker is the only separate runtime.

## Stage 1 identity boundary

- Authentication uses short-lived HS256 bearer JWTs containing only `sub` and
  `role`, with issuer and audience checks.
- Passwords are hashed with bcrypt cost 12. Inputs that bcrypt would truncate
  beyond 72 UTF-8 bytes are rejected.
- Global guards make routes authenticated by default. Explicit `@Public()`
  metadata opens system, health, registration, login, and product reads.
- Public registration always writes `USER`; only the controlled seed can create
  or promote the Stage 1 `ADMIN` identity.
- `/admin/profile` proves the API-side RBAC boundary; Stage 5 administration
  routes reuse the same server-side guard.
- Authentication endpoints are limited to five requests per minute per tracker;
  the remaining API uses a 120-request-per-minute baseline.

## Stage 2 order boundary

- The browser cart is a convenience surface, not a pricing authority. `POST
/orders` accepts only `productId` and `quantity`; unknown price fields fail
  request validation.
- The Orders repository reloads products and creates the order plus all item
  snapshots in one serializable PostgreSQL transaction.
- The API rejects missing/inactive products, mixed currencies, quantities above
  stock, integer overflow, and malformed carts before persistence.
- `subtotal_amount`, `total_amount`, `unit_price_amount`, and
  `line_total_amount` are integer minor units. PostgreSQL checks enforce
  nonnegative amounts and arithmetic consistency.
- List, detail, and cancellation queries include the JWT subject in their
  database predicate. Foreign orders return the same 404 as absent orders.
- Every status mutation passes through the explicit order transition function.
  Stage 2 exposes only `PENDING_PAYMENT → CANCELLED`; later transitions remain
  inaccessible until their specified stages.

## Stage 3 payment boundary

- `POST /payments/checkout-session` accepts only an owned order ID. Local item
  snapshots and totals supply Stripe's Checkout line items.
- `Payment` is separate from `Order`; it stores the order amount/currency,
  provider state, attempt number, Checkout references, and a stable idempotency
  key before any third-party request.
- Payment reservation and pending-order cancellation take the same transaction-
  scoped PostgreSQL advisory lock. Serializable retries are bounded.
- Provider calls occur outside database transactions and have individual
  `PaymentAttempt` audit rows. Stripe results are checked against local amount
  and currency before the explicit `CREATED → PENDING` transition.
- The result page reads the protected local API and ignores redirect query data.
  A browser return cannot mark an order paid; Stage 4 webhook handling is the
  final authority.

## Stage 4 webhook boundary

- `POST /webhooks/stripe` is public at the JWT layer but authenticates the
  sender cryptographically with the `Stripe-Signature` header and exact raw
  request bytes. Missing configuration or invalid signatures fail closed before
  persistence.
- Only sandbox events are accepted. The mapper handles Checkout completion,
  asynchronous Checkout outcomes, and PaymentIntent processing/success/failure;
  unknown or unrelated signed events are durably marked `IGNORED`.
- Every verified event is stored in `webhook_events` as JSONB. A unique
  `provider_event_id` is the final deduplication boundary; a transaction-scoped
  advisory lock makes concurrent duplicate deliveries converge before the
  unique constraint is reached.
- Recognized events lock the order/payment concurrency boundary, verify local
  IDs, provider references, amount, and currency, then call explicit transition
  functions. `Payment → SUCCEEDED` and `Order → PAID` commit in the same locked
  transaction.
- Terminal success/refund states cannot move backward when an older failed or
  processing event arrives. Deterministic integrity failures persist as
  `FAILED` and return a non-2xx response without changing business state.

## Stage 5 refund and administration boundary

- `POST /admin/payments/:id/refunds` requires ADMIN and accepts a stable request
  UUID, audit reason, and optional positive integer amount. Omitting amount
  means the full remaining balance.
- The repository takes the shared order advisory lock plus order/payment row
  locks before summing pending and successful Refund rows. Reservation and
  `REFUND_REQUESTED` audit commit before the provider call.
- Stripe receives `refund:create:{paymentId}:{refundRequestId}`. Unknown network
  outcomes remain `PENDING` for same-key retry; deterministic provider rejection
  becomes `FAILED`.
- Direct provider responses and signed `refund.created`, `refund.updated`, and
  `refund.failed` events use the same locked projection. They validate local and
  provider IDs, amount, and currency before explicit Refund, Payment, and Order
  transitions.
- `charge.refunded` is retained as a signed audit-only event under the current
  Stripe Refund event model, preventing two competing detail sources.
- All administrator list endpoints are filtered, bounded, paginated, and
  supported by status/time/provider indexes. Refund dashboard totals are grouped
  by currency.
- The Next.js operations console renders dashboard, order/payment detail,
  provider attempts, full/partial refund submission, webhook delivery counts
  and errors, and audit metadata. Browser visibility never replaces API RBAC.

## Stage 6 verification boundary

- The dedicated Failure Lab drives the real NestJS HTTP surface and PostgreSQL
  repositories while substituting deterministic Stripe sandbox gateways. This
  keeps provider outcomes reproducible without weakening application locks,
  transactions, validation, raw-body signature checks, or authorization.
- Five concurrent payment requests must converge on one Payment and one stable
  provider idempotency key. A provider timeout after acceptance is retried with
  that same key and records both attempts.
- Duplicate and out-of-order signed events exercise the durable webhook inbox
  and terminal-state protections. A simulated process termination proves that
  provider retry restores consistency.
- A temporary database constraint injects failure between the Payment and Order
  writes. The webhook transaction must roll back both writes and its inbox row
  before a clean replay succeeds.
- Duplicate and concurrent refund requests prove business-key idempotency and
  the cumulative refund ceiling. A USER request proves the API-side 403 boundary.
- The ten scenarios run in GitHub Actions after migrations and seed, and remain
  independently reproducible with `pnpm test:failure-lab`.

## Stage 7 provider adapter boundary

- `@payflow/payment-core` is framework-neutral and owns `PaymentProvider`,
  normalized provider payment/refund statuses, webhook actions, capabilities,
  and `PaymentProviderError`. It has no NestJS, Prisma, database, or provider SDK
  dependency.
- The contract exposes `createPayment`, `getPayment`, optional `capturePayment`
  and `cancelPayment`, `refundPayment`, and `verifyWebhook` as specified. Stable
  business idempotency keys are inputs rather than generated by the adapter.
- `@payflow/payment-stripe` alone imports Stripe SDK. It translates hosted
  Checkout, PaymentIntent lookup/capture/cancel, Refund responses, current
  signed Event types, request IDs, and provider errors into the core contract.
- A global NestJS composition module constructs one `StripeProvider` from
  validated environment values and binds it to the core injection token.
  Payments, Refunds, and Webhooks services depend only on `PaymentProvider`.
- Repository boundaries accept the normalized provider identity and action;
  Stripe Event types no longer cross into business state or persistence code.
- Scoped ESLint `no-restricted-imports` rules reject direct `stripe` imports in
  API production code and direct adapter imports outside the composition root.
- Stage 8 extends this boundary; Stage 7's adapter isolation remains enforced.

## Stage 8 PayPal and queue boundary

- `PaymentProviderRegistry` selects Stripe or PayPal by the requested and then
  persisted provider identity. Payments and refunds keep one provider-neutral
  business interface; switching providers never changes Order or Refund rules.
- `@payflow/payment-paypal` uses PayPal Sandbox Orders v2, OAuth client
  credentials, capture/refund endpoints, `PayPal-Request-Id` idempotency, and
  PayPal's verification endpoint. It converts decimal provider amounts to exact
  integer minor units before domain code sees them.
- Both public webhook routes verify the exact raw body before persistence.
  Valid events are deduplicated in PostgreSQL, enqueued by WebhookEvent UUID,
  and acknowledged without waiting for business-state processing.
- `apps/worker` consumes `payflow-webhooks` jobs. Transient network, rate-limit,
  and provider 5xx failures retry at most five times with exponential backoff;
  deterministic integrity/state-machine failures use BullMQ's unrecoverable
  path and are not blindly retried.
- PostgreSQL records receive time, queue job ID, attempt count, last processing
  start, terminal result, and a bounded safe error. Redis is transport and
  operational telemetry, never the authoritative payment ledger.
- `GET /admin/queues/webhooks` exposes waiting, active, delayed, completed, and
  failed jobs plus attempt counts. Failed jobs are retained for seven days (up
  to 2,000) as the Stage 8 dead-letter/operations surface.
- A partial unique index permits at most one successful/refunded Payment per
  Order across all providers.

## Data boundary

`users` stores UUID identity, normalized unique email, bcrypt password hash,
role, and timestamp. `products` stores UUID, SKU, display name, integer
minor-unit price, three-letter currency, stock, and active state. `orders`
stores ownership, display number, state, currency, integer totals, and creation
time. `order_items` stores the product reference plus immutable SKU, name, unit
price, quantity, and line-total snapshots. `payments` stores provider lifecycle,
amount, idempotency, and Checkout references; `payment_attempts` records provider
calls. PostgreSQL checks enforce lowercase
emails, nonnegative money/stock, positive item quantities, arithmetic equality,
and uppercase three-letter currency. `refunds` stores request/provider identity,
integer amount, lifecycle, reason, and provider failure details. `audit_logs`
stores administrator/system actor, action, target, JSON metadata, and timestamp.
`webhook_events` stores the original verified Event JSON, normalized action,
provider ID/type, delivery count, queue job ID, processing attempt count,
provider/receive/queue/process timestamps, and a bounded safe processing error;
none of these tables store card numbers or CVC data added by PayFlow.

## Runtime topology

Docker Compose starts five services:

1. `postgres` owns persistent local database data.
2. `redis` persists BullMQ state with AOF enabled.
3. `api` applies committed migrations, runs the idempotent admin/product seed,
   then serves REST, health, and Swagger.
4. `worker` consumes verified webhook-event jobs and updates PostgreSQL.
5. `web` serves the responsive catalog and browser-based auth surfaces.

The API validates environment variables at startup. Request IDs and the shared
`code`, `message`, `requestId`, and `details` error envelope remain in force.

## Deferred boundaries

- Outbox, ledger, and reconciliation — Stage 9.
- OpenTelemetry and portfolio packaging — Stage 10.
