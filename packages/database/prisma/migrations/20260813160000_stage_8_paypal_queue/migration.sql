ALTER TYPE "PaymentProvider" ADD VALUE 'PAYPAL';

ALTER TABLE "webhook_events"
  ADD COLUMN "action_json" JSONB,
  ADD COLUMN "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "queue_job_id" VARCHAR(255),
  ADD COLUMN "provider_occurred_at" TIMESTAMPTZ(3),
  ADD COLUMN "queued_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_processing_started_at" TIMESTAMPTZ(3);

CREATE INDEX "webhook_events_queue_job_id_idx"
  ON "webhook_events"("queue_job_id");

CREATE UNIQUE INDEX "payments_one_successful_payment_per_order"
  ON "payments"("order_id")
  WHERE "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');
