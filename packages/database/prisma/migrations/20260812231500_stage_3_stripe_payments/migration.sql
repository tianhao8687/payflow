-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'STARTED',
  'SUCCEEDED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "amount" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "provider_payment_id" VARCHAR(255),
  "provider_checkout_session_id" VARCHAR(255),
  "checkout_url" TEXT,
  "checkout_expires_at" TIMESTAMPTZ(3),
  "idempotency_key" VARCHAR(255) NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_attempts" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "provider_request_id" VARCHAR(255),
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_checkout_session_id_key"
  ON "payments"("provider_checkout_session_id");
CREATE UNIQUE INDEX "payments_idempotency_key_key"
  ON "payments"("idempotency_key");
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key"
  ON "payments"("provider", "provider_payment_id");
CREATE UNIQUE INDEX "payments_order_id_provider_attempt_no_key"
  ON "payments"("order_id", "provider", "attempt_no");
CREATE INDEX "payments_order_id_created_at_idx"
  ON "payments"("order_id", "created_at");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payment_attempts_payment_id_created_at_idx"
  ON "payment_attempts"("payment_id", "created_at");

-- One order can keep multiple failed attempts, but only one payment that has
-- actually succeeded or moved into a refund state.
CREATE UNIQUE INDEX "payments_one_success_per_order_key"
  ON "payments"("order_id")
  WHERE "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- AddForeignKey
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve integer-money and local provider invariants even for writes outside
-- Prisma. Checkout data is either wholly absent or complete.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payments_attempt_no_positive" CHECK ("attempt_no" > 0),
  ADD CONSTRAINT "payments_checkout_fields_complete" CHECK (
    (
      "provider_checkout_session_id" IS NULL
      AND "checkout_url" IS NULL
      AND "checkout_expires_at" IS NULL
    )
    OR
    (
      "provider_checkout_session_id" IS NOT NULL
      AND "checkout_url" IS NOT NULL
      AND "checkout_expires_at" IS NOT NULL
    )
  );
