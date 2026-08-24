-- Phase 3.6: adaptation outcome tracking (additive, nullable for old rows)

ALTER TABLE "HabitAdjustmentProposal" ADD COLUMN     "baselineCompletionRate" DOUBLE PRECISION,
ADD COLUMN     "baselineMissRate" DOUBLE PRECISION,
ADD COLUMN     "baselineStreak" INTEGER,
ADD COLUMN     "baselineRiskLevel" TEXT,
ADD COLUMN     "baselineRiskScore" DOUBLE PRECISION,
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "evaluationStartDate" TEXT,
ADD COLUMN     "evaluationEndDate" TEXT,
ADD COLUMN     "scheduledOpportunities" INTEGER,
ADD COLUMN     "postCompletionRate" DOUBLE PRECISION,
ADD COLUMN     "postMissRate" DOUBLE PRECISION,
ADD COLUMN     "postStreak" INTEGER,
ADD COLUMN     "postRiskLevel" TEXT,
ADD COLUMN     "postRiskScore" DOUBLE PRECISION,
ADD COLUMN     "outcome" TEXT;

CREATE INDEX "HabitAdjustmentProposal_status_outcome_idx" ON "HabitAdjustmentProposal"("status", "outcome");
