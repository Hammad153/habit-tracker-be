-- Extend the existing Daily Plan task model into roadmap activities while
-- preserving every existing task row as an activity on its current plan.
ALTER TYPE "DailyPlanTaskStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

CREATE TYPE "CompletionSource" AS ENUM ('DAILY_PLAN');

ALTER TABLE "DailyPlanTask"
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "DailyPlanTask"
SET "completedAt" = "updatedAt"
WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

ALTER TABLE "Completion"
  ADD COLUMN "source" "CompletionSource",
  ADD COLUMN "sourceReferenceId" TEXT;

CREATE INDEX "DailyPlanTask_habitId_status_idx" ON "DailyPlanTask"("habitId", "status");
CREATE INDEX "Completion_source_sourceReferenceId_idx" ON "Completion"("source", "sourceReferenceId");
