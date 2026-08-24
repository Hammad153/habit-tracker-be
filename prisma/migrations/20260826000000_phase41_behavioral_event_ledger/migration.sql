-- Phase 4.1: immutable behavioral intent/outcome event ledger

-- CreateEnum
CREATE TYPE "BehavioralEventType" AS ENUM (
  'INTERVENTION_GENERATED',
  'INTERVENTION_VIEWED',
  'INTERVENTION_DISMISSED',
  'INTERVENTION_ACTION_STARTED',
  'INTERVENTION_ACTION_COMPLETED',
  'ADAPTIVE_PROPOSAL_GENERATED',
  'ADAPTIVE_PROPOSAL_VIEWED',
  'ADAPTIVE_PROPOSAL_ACCEPTED',
  'ADAPTIVE_PROPOSAL_REJECTED',
  'NOTIFICATION_CANDIDATE_GENERATED',
  'NOTIFICATION_DELIVERED',
  'NOTIFICATION_OPENED',
  'NOTIFICATION_DISMISSED',
  'NOTIFICATION_ACTION_STARTED',
  'NOTIFICATION_ACTION_COMPLETED',
  'WEEKLY_REVIEW_VIEWED',
  'WEEKLY_REVIEW_REGENERATED'
);

-- CreateTable
CREATE TABLE "BehavioralEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT,
    "type" "BehavioralEventType" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposalId" TEXT,
    "notificationDeliveryId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BehavioralEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BehavioralEvent_userId_fingerprint_type_key" ON "BehavioralEvent"("userId", "fingerprint", "type");
CREATE INDEX "BehavioralEvent_userId_occurredAt_idx" ON "BehavioralEvent"("userId", "occurredAt");
CREATE INDEX "BehavioralEvent_habitId_occurredAt_idx" ON "BehavioralEvent"("habitId", "occurredAt");
CREATE INDEX "BehavioralEvent_type_occurredAt_idx" ON "BehavioralEvent"("type", "occurredAt");
CREATE INDEX "BehavioralEvent_fingerprint_idx" ON "BehavioralEvent"("fingerprint");

ALTER TABLE "BehavioralEvent" ADD CONSTRAINT "BehavioralEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
