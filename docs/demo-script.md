# PayFlow ten-minute demo script

This walkthrough demonstrates the delivered architecture without live money or
provider credentials. Start with `docker compose up --build --wait` and keep one
terminal available for logs.

## 0:00–1:00 — System readiness

1. Open `http://localhost:4000/health` and show both `database: up` and
   `redis: up`.
2. Open `http://localhost:4000/docs` and note the REST/OpenAPI boundary.
3. Run `docker compose ps`; all five services should be healthy/running.

Talking point: health is a real dependency probe, not a static process-liveness
response.

## 1:00–3:00 — Customer and server-authoritative order

1. Open `http://localhost:3000` and inspect the responsive catalog.
2. Register a USER, add products to the cart, and create an order.
3. Open the order detail and point out integer minor-unit totals and immutable
   item snapshots.

Talking point: the browser sends product IDs and quantities; PostgreSQL-backed
API code reloads prices and owns the final total.

## 3:00–5:00 — Payment trust boundary

1. On the order, show Stripe Test and PayPal Sandbox provider selection.
2. If sandbox credentials are configured, create hosted checkout and stop
   before entering any real credential. Otherwise show the deliberate
   fail-closed configuration response.
3. Explain that provider redirect/return never marks an order paid; only a
   verified, queued webhook can commit payment state.

Talking point: stable business idempotency keys, advisory locks, exact raw-body
signature verification, and explicit state machines defend retries and races.

## 5:00–7:00 — Worker, ledger, and reconciliation

1. Sign in as the seeded ADMIN and open `/admin`.
2. Show queue attempts, outbox delivery, balanced ledger pairs, reconciliation
   runs/issues, and audit history.
3. Open `docs/payment-flow.md` or the README Mermaid diagram to connect the UI
   to API → webhook inbox → BullMQ → worker → outbox → ledger.

Talking point: Redis is transport; PostgreSQL remains the source of truth and a
deferred database trigger rejects an unbalanced ledger transaction at commit.

## 7:00–9:00 — Observability

1. Open `http://localhost:9464/metrics` and
   `http://localhost:9465/metrics`; search for the six names documented in
   `docs/observability.md`.
2. Send a request with a caller ID:

   ```powershell
   Invoke-WebRequest http://localhost:4000/health -Headers @{
     'x-request-id' = 'portfolio-demo-1'
   }
   docker compose logs api --tail 10
   ```

3. Show the response header and matching JSON log. If an OTLP backend is
   configured, search for the same `traceId` and show the API/DB/queue/worker
   span chain.

Talking point: secrets and raw webhook bodies are excluded/redacted; metric
labels remain bounded; idempotent replay does not double-count money outcomes.

## 9:00–10:00 — Evidence

Run:

```powershell
pnpm test:stage-10
```

Summarize the layers of evidence: unit/adapter contracts, real PostgreSQL/Redis
E2E, ten deterministic failure scenarios, production builds, secret scanning,
responsive browser QA, and GitHub Actions. Close with the safety boundary:
PayFlow is sandbox-only and stores no card number or CVC.

## Reset

Stop without deleting local data:

```powershell
docker compose down
```

To demonstrate from a clean database, use a separately named disposable
Compose project/volume rather than deleting an existing developer environment.
