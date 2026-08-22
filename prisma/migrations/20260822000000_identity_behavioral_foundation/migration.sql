-- CreateEnum
CREATE TYPE "CompletionKind" AS ENUM ('FULL', 'MINIMUM', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RewardTransactionType" AS ENUM ('HABIT_COMPLETION', 'HABIT_MINIMUM_COMPLETION', 'HABIT_EMERGENCY_COMPLETION', 'STREAK_MILESTONE', 'STREAK_FREEZE', 'REWARD_REDEMPTION', 'ADJUSTMENT', 'REVERSAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "emergencyMinimum" TEXT,
ADD COLUMN     "fullBehavior" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "minimumBehavior" TEXT,
ADD COLUMN     "scheduledTime" TEXT,
ADD COLUMN     "stackAfterHabitId" TEXT;

-- AlterTable
ALTER TABLE "Completion" ADD COLUMN     "kind" "CompletionKind" NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "status" "IdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityHabit" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityHabit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "RewardTransactionType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Identity_userId_status_idx" ON "Identity"("userId", "status");

-- CreateIndex
CREATE INDEX "IdentityHabit_habitId_idx" ON "IdentityHabit"("habitId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityHabit_identityId_habitId_key" ON "IdentityHabit"("identityId", "habitId");

-- CreateIndex
CREATE INDEX "RewardLedger_userId_createdAt_idx" ON "RewardLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_type_referenceId_key" ON "RewardLedger"("type", "referenceId");

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_stackAfterHabitId_fkey" FOREIGN KEY ("stackAfterHabitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityHabit" ADD CONSTRAINT "IdentityHabit_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityHabit" ADD CONSTRAINT "IdentityHabit_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
