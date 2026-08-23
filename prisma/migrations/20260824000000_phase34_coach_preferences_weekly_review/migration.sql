-- Phase 3.4: persistent coach preferences + weekly behavioral reviews

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coachEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "aiCoachEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "coachTone" TEXT NOT NULL DEFAULT 'BALANCED',
ADD COLUMN     "coachFrequency" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "weeklyReviewEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WeeklyBehaviorReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "weekEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "provider" TEXT NOT NULL DEFAULT 'fallback',
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "wins" JSONB NOT NULL DEFAULT '[]',
    "patterns" JSONB NOT NULL DEFAULT '[]',
    "identityReflection" TEXT NOT NULL DEFAULT '',
    "nextWeekFocus" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyBehaviorReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyBehaviorReview_userId_weekStart_key" ON "WeeklyBehaviorReview"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "WeeklyBehaviorReview_userId_updatedAt_idx" ON "WeeklyBehaviorReview"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "WeeklyBehaviorReview" ADD CONSTRAINT "WeeklyBehaviorReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
