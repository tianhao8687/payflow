DROP INDEX "webhook_events_provider_event_id_key";

CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key"
  ON "webhook_events"("provider", "provider_event_id");
