ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'ALIPAY';

ALTER TABLE "payments"
  DROP CONSTRAINT "payments_checkout_fields_complete",
  ADD CONSTRAINT "payments_checkout_fields_complete" CHECK (
    (
      "provider_checkout_session_id" IS NULL
      AND "checkout_url" IS NULL
      AND "checkout_expires_at" IS NULL
    )
    OR
    (
      "checkout_url" IS NOT NULL
      AND "checkout_expires_at" IS NOT NULL
      AND (
        "provider" = 'ALIPAY'
        OR "provider_checkout_session_id" IS NOT NULL
      )
    )
  );

ALTER TABLE "webhook_events"
  ADD COLUMN "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dispatch_error" VARCHAR(500),
  ADD COLUMN "dispatch_lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "payload_hash" VARCHAR(64),
  ADD COLUMN "last_dispatch_attempt_at" TIMESTAMPTZ(3);

ALTER TABLE "reconciliation_runs"
  ADD COLUMN "page_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkpoint_updated_at" TIMESTAMPTZ(3),
  ADD COLUMN "checkpoint_payment_id" UUID;

ALTER TABLE "refunds"
  ADD COLUMN "last_provider_attempt_at" TIMESTAMPTZ(3);

CREATE INDEX "webhook_events_dispatch_pending_idx"
  ON "webhook_events"("status", "queued_at", "received_at");

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_payload_hash_format"
  CHECK ("payload_hash" IS NULL OR "payload_hash" ~ '^[a-f0-9]{64}$');
