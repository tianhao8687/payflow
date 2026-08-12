-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'SYSTEM');

-- Extend the durable webhook inbox for the Stage 5 operations console.
ALTER TABLE "webhook_events"
  ADD COLUMN "delivery_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "processing_error" VARCHAR(500),
  ADD COLUMN "last_received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "orders_status_idx";
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");
CREATE INDEX "payments_provider_status_created_at_idx"
  ON "payments"("provider", "status", "created_at");
CREATE INDEX "webhook_events_event_type_received_at_idx"
  ON "webhook_events"("event_type", "received_at");

-- CreateTable
CREATE TABLE "refunds" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "refund_request_id" UUID NOT NULL,
  "provider_refund_id" VARCHAR(255),
  "amount" INTEGER NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(500) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "provider_request_id" VARCHAR(255),
  "failure_code" VARCHAR(100),
  "failure_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "actor_type" "AuditActorType" NOT NULL,
  "actor_id" UUID,
  "action" VARCHAR(100) NOT NULL,
  "target_type" VARCHAR(100) NOT NULL,
  "target_id" VARCHAR(255) NOT NULL,
  "metadata_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key"
  ON "refunds"("provider_refund_id");
CREATE UNIQUE INDEX "refunds_idempotency_key_key"
  ON "refunds"("idempotency_key");
CREATE UNIQUE INDEX "refunds_payment_id_refund_request_id_key"
  ON "refunds"("payment_id", "refund_request_id");
CREATE INDEX "refunds_payment_id_created_at_idx"
  ON "refunds"("payment_id", "created_at");
CREATE INDEX "refunds_status_created_at_idx"
  ON "refunds"("status", "created_at");
CREATE INDEX "audit_logs_actor_id_created_at_idx"
  ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx"
  ON "audit_logs"("action", "created_at");
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx"
  ON "audit_logs"("target_type", "target_id", "created_at");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce integer-money and basic audit invariants below Prisma.
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "refunds_reason_not_blank" CHECK (length(btrim("reason")) > 0);

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_delivery_count_positive"
  CHECK ("delivery_count" > 0);
