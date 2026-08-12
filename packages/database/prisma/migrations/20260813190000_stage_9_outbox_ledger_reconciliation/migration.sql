CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'PROCESSED', 'FAILED');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerTransactionType" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS');
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "ReconciliationIssueType" AS ENUM ('AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'STATUS_MISMATCH', 'REFUND_TOTAL_MISMATCH');

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_key" VARCHAR(255) NOT NULL,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "publish_attempts" INTEGER NOT NULL DEFAULT 0,
  "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  "queue_job_id" VARCHAR(255),
  "last_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(3),
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_accounts_currency_format" CHECK ("currency" = upper("currency") AND char_length("currency") = 3)
);

CREATE TABLE "ledger_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "outbox_event_id" UUID NOT NULL,
  "transaction_type" "LedgerTransactionType" NOT NULL,
  "reference_type" VARCHAR(100) NOT NULL,
  "reference_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_transactions_currency_format" CHECK ("currency" = upper("currency") AND char_length("currency") = 3)
);

CREATE TABLE "ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transaction_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "ledger_entries_currency_format" CHECK ("currency" = upper("currency") AND char_length("currency") = 3)
);

CREATE TABLE "reconciliation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  "window_end" TIMESTAMPTZ(3) NOT NULL,
  "checked_count" INTEGER NOT NULL DEFAULT 0,
  "passed_count" INTEGER NOT NULL DEFAULT 0,
  "issue_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_runs_window_order" CHECK ("window_start" < "window_end"),
  CONSTRAINT "reconciliation_runs_counts_nonnegative" CHECK (
    "checked_count" >= 0 AND "passed_count" >= 0 AND "issue_count" >= 0 AND "error_count" >= 0
  )
);

CREATE TABLE "reconciliation_checks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "matched" BOOLEAN NOT NULL,
  "local_snapshot" JSONB NOT NULL,
  "provider_snapshot" JSONB,
  "error" VARCHAR(500),
  "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_issues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "check_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "issue_type" "ReconciliationIssueType" NOT NULL,
  "local_snapshot" JSONB NOT NULL,
  "provider_snapshot" JSONB NOT NULL,
  "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_id" UUID,
  CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_issues_resolution_consistent" CHECK (
    ("status" = 'OPEN' AND "resolved_at" IS NULL AND "resolved_by_id" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "outbox_events_event_key_key" ON "outbox_events"("event_key");
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "outbox_events_event_type_created_at_idx" ON "outbox_events"("event_type", "created_at");
CREATE INDEX "outbox_events_queue_job_id_idx" ON "outbox_events"("queue_job_id");

CREATE UNIQUE INDEX "ledger_accounts_code_currency_key" ON "ledger_accounts"("code", "currency");
CREATE INDEX "ledger_accounts_currency_code_idx" ON "ledger_accounts"("currency", "code");
CREATE UNIQUE INDEX "ledger_transactions_outbox_event_id_key" ON "ledger_transactions"("outbox_event_id");
CREATE INDEX "ledger_transactions_reference_type_reference_id_created_at_idx" ON "ledger_transactions"("reference_type", "reference_id", "created_at");
CREATE INDEX "ledger_transactions_transaction_type_created_at_idx" ON "ledger_transactions"("transaction_type", "created_at");
CREATE UNIQUE INDEX "ledger_entries_transaction_id_account_id_direction_key" ON "ledger_entries"("transaction_id", "account_id", "direction");
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");
CREATE INDEX "reconciliation_runs_status_started_at_idx" ON "reconciliation_runs"("status", "started_at");
CREATE UNIQUE INDEX "reconciliation_checks_run_id_payment_id_key" ON "reconciliation_checks"("run_id", "payment_id");
CREATE INDEX "reconciliation_checks_payment_id_checked_at_idx" ON "reconciliation_checks"("payment_id", "checked_at");
CREATE INDEX "reconciliation_checks_matched_checked_at_idx" ON "reconciliation_checks"("matched", "checked_at");
CREATE INDEX "reconciliation_issues_status_detected_at_idx" ON "reconciliation_issues"("status", "detected_at");
CREATE INDEX "reconciliation_issues_provider_status_detected_at_idx" ON "reconciliation_issues"("provider", "status", "detected_at");
CREATE INDEX "reconciliation_issues_payment_id_detected_at_idx" ON "reconciliation_issues"("payment_id", "detected_at");
CREATE INDEX "reconciliation_issues_run_id_idx" ON "reconciliation_issues"("run_id");
CREATE UNIQUE INDEX "reconciliation_issues_one_open_type_per_payment" ON "reconciliation_issues"("payment_id", "issue_type") WHERE "status" = 'OPEN';

ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_outbox_event_id_fkey"
  FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_checks" ADD CONSTRAINT "reconciliation_checks_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_checks" ADD CONSTRAINT "reconciliation_checks_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_check_id_fkey"
  FOREIGN KEY ("check_id") REFERENCES "reconciliation_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "payflow_enforce_ledger_balance"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_transaction_id UUID;
  entry_count INTEGER;
  signed_total BIGINT;
  invalid_currency_count INTEGER;
BEGIN
  affected_transaction_id := COALESCE(NEW."transaction_id", OLD."transaction_id");

  IF NOT EXISTS (
    SELECT 1 FROM "ledger_transactions" WHERE "id" = affected_transaction_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM(CASE WHEN entry."direction" = 'DEBIT' THEN entry."amount" ELSE -entry."amount" END), 0),
    COUNT(*) FILTER (
      WHERE entry."currency" <> ledger_tx."currency"
         OR entry."currency" <> account."currency"
    )::INTEGER
  INTO entry_count, signed_total, invalid_currency_count
  FROM "ledger_transactions" ledger_tx
  LEFT JOIN "ledger_entries" entry ON entry."transaction_id" = ledger_tx."id"
  LEFT JOIN "ledger_accounts" account ON account."id" = entry."account_id"
  WHERE ledger_tx."id" = affected_transaction_id
  GROUP BY ledger_tx."id";

  IF entry_count < 2 OR signed_total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % must contain at least two entries with a zero signed balance', affected_transaction_id
      USING ERRCODE = '23514';
  END IF;

  IF invalid_currency_count <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % contains a currency mismatch', affected_transaction_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entries_balance_at_commit"
AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "payflow_enforce_ledger_balance"();
