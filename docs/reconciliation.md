# Outbox, ledger, and reconciliation

Stage 9 adds three financial-integrity boundaries without changing the existing
Order, Payment, Refund, or provider-adapter ownership rules.

## Transactional outbox

Successful payment and refund projections append a unique money event inside
the same PostgreSQL transaction as the business-state update:

| Event type          | Aggregate | Stable event key                |
| ------------------- | --------- | ------------------------------- |
| `PAYMENT_SUCCEEDED` | Payment   | `payment.succeeded:{paymentId}` |
| `REFUND_SUCCEEDED`  | Refund    | `refund.succeeded:{refundId}`   |

The worker polls only `PENDING` rows, enqueues the OutboxEvent UUID as the
BullMQ job ID, and records `published_at`. A crash before enqueue leaves the row
pending. A crash after enqueue is safe because the queue ID and ledger's unique
`outbox_event_id` make replay idempotent. Processing attempts and bounded error
text remain in PostgreSQL; a terminal processing failure becomes `FAILED`
instead of disappearing.

The provider-webhook inbox and the financial outbox are separate on purpose.
The inbox proves that a provider event was authenticated and durably received;
the outbox proves that an accepted local money-state transition will reach its
downstream ledger effect.

## Double-entry ledger

Each processed money event creates one `ledger_transactions` row and exactly
two entries in integer minor units:

| Business event | Debit                     | Credit                    |
| -------------- | ------------------------- | ------------------------- |
| Payment        | Provider receivable       | Customer payment clearing |
| Refund         | Customer payment clearing | Provider receivable       |

An OutboxEvent can own only one ledger transaction. Account identity is unique
by `(code, currency)`, and every entry currency must equal both the account and
transaction currency.

PostgreSQL is the final invariant boundary. A deferred constraint trigger runs
at transaction commit and rejects a ledger transaction unless it contains at
least two entries and:

```text
sum(DEBIT amount) - sum(CREDIT amount) = 0
```

Deferral lets both sides be inserted atomically while preventing a partially
balanced transaction from ever committing.

## Scheduled reconciliation

The worker runs a bounded lookback scan over locally updated provider payments.
For each payment with a provider payment ID it records a
`reconciliation_checks` row containing immutable local and provider snapshots.
The comparison covers:

- amount in integer minor units;
- uppercase ISO currency;
- normalized provider payment status;
- cumulative successful refund total when the provider lookup exposes it.

Stripe retrieves the PaymentIntent with `latest_charge` expanded and compares
the Charge's `amount_refunded`. PayPal retrieves the capture through Payments
v2. That capture lookup does not provide a dependable cumulative refund amount,
so the adapter returns `null` for that field and the service does not invent a
value; amount, currency, and normalized status are still checked. Local refund
totals always come from successful Refund rows.

A difference creates or refreshes one open issue per
`(payment_id, issue_type)`. PostgreSQL advisory locks and a partial unique index
make concurrent scans converge. Runs, successful checks, provider errors, local
snapshots, provider snapshots, issue detection, and administrator resolution
are all retained. Resolving an issue is idempotent and writes exactly one ADMIN
audit record.

## Operations surface

`GET /admin/integrity` returns bounded recent views of:

- outbox counts, attempts, timestamps, and safe errors;
- ledger transactions, their entries, and computed balance;
- reconciliation runs and pass/issue/error totals;
- open and resolved differences with both snapshots.

`PATCH /admin/reconciliation/issues/:id/resolve` requires the API-verified
`ADMIN` role. The Next.js Integrity panel exposes the same data and action; UI
visibility is not an authorization boundary.

## Worker configuration

| Variable                         | Default    | Purpose                           |
| -------------------------------- | ---------- | --------------------------------- |
| `OUTBOX_POLL_INTERVAL_MS`        | `500`      | Pending-event polling interval    |
| `OUTBOX_WORKER_CONCURRENCY`      | `4`        | Concurrent ledger jobs            |
| `RECONCILIATION_INTERVAL_MS`     | `900000`   | Scheduled scan interval           |
| `RECONCILIATION_LOOKBACK_MS`     | `86400000` | Local payment update lookback     |
| `STRIPE_RECONCILIATION_KEY`      | empty      | Test-mode read credential         |
| `PAYPAL_CLIENT_ID` / `...SECRET` | empty      | PayPal Sandbox lookup credentials |

Use a restricted Stripe test key with PaymentIntent and Charge read access
where available. `sk_test_...` is accepted only as a sandbox-development
fallback. Live keys are rejected, secrets never enter the browser, and tracked
files are scanned before commit and in CI.

## Deliberate mismatch drill

The automated Stage 9 acceptance test completes a payment, posts its balanced
payment and refund ledger transactions, then deliberately changes only the
local Payment status. A reconciliation run must discover a
`STATUS_MISMATCH`; a USER must receive `403`; an ADMIN must see and resolve the
issue; and repeated resolution must create only one resolution audit event.

Only a newly opened issue increments `reconciliation_issue_total`; a later scan
that refreshes the same open issue does not inflate the counter. Provider lookup
is a child span of `reconciliation.run`, and scheduled-run logs contain summary
counts but never provider credentials or snapshots that could carry secrets.

Run it against local PostgreSQL and Redis:

```powershell
$env:RUN_REDIS_INTEGRATION = 'true'
pnpm test:stage-9
```
