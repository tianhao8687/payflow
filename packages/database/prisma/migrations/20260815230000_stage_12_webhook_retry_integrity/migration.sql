ALTER TABLE "webhook_events"
  ADD COLUMN "next_dispatch_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "event_fingerprint" VARCHAR(64);

CREATE INDEX "webhook_events_dispatch_due_idx"
  ON "webhook_events"(
    "status",
    "queued_at",
    "next_dispatch_at",
    "received_at",
    "id"
  );

DROP INDEX IF EXISTS "webhook_events_dispatch_pending_idx";

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_event_fingerprint_format"
  CHECK (
    "event_fingerprint" IS NULL
    OR "event_fingerprint" ~ '^[a-f0-9]{64}$'
  );
