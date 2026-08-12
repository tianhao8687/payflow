-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "provider_event_id" VARCHAR(255) NOT NULL,
  "event_type" VARCHAR(255) NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- provider_event_id is the durable idempotency boundary required by the spec.
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key"
  ON "webhook_events"("provider_event_id");
CREATE INDEX "webhook_events_provider_received_at_idx"
  ON "webhook_events"("provider", "received_at");
CREATE INDEX "webhook_events_status_received_at_idx"
  ON "webhook_events"("status", "received_at");
