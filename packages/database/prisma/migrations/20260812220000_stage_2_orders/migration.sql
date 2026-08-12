-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING_PAYMENT',
  'PAID',
  'FULFILLED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);

-- CreateTable
CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "order_no" VARCHAR(32) NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "currency" CHAR(3) NOT NULL,
  "subtotal_amount" INTEGER NOT NULL,
  "total_amount" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "sku_snapshot" VARCHAR(64) NOT NULL,
  "name_snapshot" VARCHAR(160) NOT NULL,
  "unit_price_amount" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "line_total_amount" INTEGER NOT NULL,

  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- AddForeignKey
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money, quantity, and ISO-style currency invariants remain valid even for
-- writes that bypass the application layer.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "orders_subtotal_amount_nonnegative" CHECK ("subtotal_amount" >= 0),
  ADD CONSTRAINT "orders_total_amount_nonnegative" CHECK ("total_amount" >= 0),
  ADD CONSTRAINT "orders_total_matches_subtotal" CHECK ("total_amount" = "subtotal_amount");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("unit_price_amount" >= 0),
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_line_total_nonnegative" CHECK ("line_total_amount" >= 0),
  ADD CONSTRAINT "order_items_line_total_matches" CHECK (
    "line_total_amount" = "unit_price_amount" * "quantity"
  );
