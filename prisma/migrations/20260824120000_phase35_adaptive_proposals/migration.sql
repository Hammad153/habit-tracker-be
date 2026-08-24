-- Phase 3.5: adaptive habit adjustment proposals (user-approved only)

CREATE TABLE "HabitAdjustmentProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "state" TEXT NOT NULL,
    "currentSnapshot" JSONB NOT NULL,
    "proposedSnapshot" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL,
    "aiHeadline" TEXT,
    "aiMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HabitAdjustmentProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HabitAdjustmentProposal_habitId_fingerprint_status_key" ON "HabitAdjustmentProposal"("habitId", "fingerprint", "status");
CREATE INDEX "HabitAdjustmentProposal_userId_createdAt_idx" ON "HabitAdjustmentProposal"("userId", "createdAt");
CREATE INDEX "HabitAdjustmentProposal_habitId_createdAt_idx" ON "HabitAdjustmentProposal"("habitId", "createdAt");

ALTER TABLE "HabitAdjustmentProposal" ADD CONSTRAINT "HabitAdjustmentProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HabitAdjustmentProposal" ADD CONSTRAINT "HabitAdjustmentProposal_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
