-- Phase 4.2: server-authoritative event classification for by-type measurement

ALTER TABLE "BehavioralEvent" ADD COLUMN     "interventionType" TEXT,
ADD COLUMN     "notificationType" TEXT;

CREATE INDEX "BehavioralEvent_interventionType_occurredAt_idx" ON "BehavioralEvent"("interventionType", "occurredAt");
CREATE INDEX "BehavioralEvent_notificationType_occurredAt_idx" ON "BehavioralEvent"("notificationType", "occurredAt");
