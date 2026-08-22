-- CreateEnum
CREATE TYPE "CompletionKind" AS ENUM ('FULL', 'MINIMUM', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RewardTransactionType" AS ENUM ('HABIT_COMPLETION', 'HABIT_MINIMUM_COMPLETION', 'HABIT_EMERGENCY_COMPLETION', 'STREAK_MILESTONE', 'IDENTITY_MILESTONE', 'STREAK_FREEZE', 'REWARD_REDEMPTION', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TemptationBundleStatus" AS ENUM ('LOCKED', 'UNLOCKED', 'USED');

-- CreateEnum
CREATE TYPE "RewardItemType" AS ENUM ('THEME', 'AVATAR', 'JOURNAL_THEME', 'CELEBRATION');

-- CreateEnum
CREATE TYPE "RewardItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "emergencyCoins" INTEGER,
ADD COLUMN     "emergencyMinimum" TEXT,
ADD COLUMN     "fullBehavior" TEXT,
ADD COLUMN     "fullCoins" INTEGER,
ADD COLUMN     "identityBonusEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "minimumBehavior" TEXT,
ADD COLUMN     "minimumCoins" INTEGER,
ADD COLUMN     "rewardFundAmount" DOUBLE PRECISION,
ADD COLUMN     "scheduledTime" TEXT,
ADD COLUMN     "stackAfterHabitId" TEXT,
ADD COLUMN     "streakBonusEnabled" BOOLEAN NOT NULL DEFAULT true;

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
    "idempotencyKey" TEXT,
    "reversalOfId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemptationBundle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TemptationBundleStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemptationBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreakFreeze" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitRewardAllocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitRewardAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL,
    "type" "RewardItemType" NOT NULL,
    "status" "RewardItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Identity_userId_status_idx" ON "Identity"("userId", "status");

-- CreateIndex
CREATE INDEX "IdentityHabit_habitId_idx" ON "IdentityHabit"("habitId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityHabit_identityId_habitId_key" ON "IdentityHabit"("identityId", "habitId");

-- CreateIndex
CREATE INDEX "RewardLedger_referenceType_referenceId_idx" ON "RewardLedger"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "RewardLedger_userId_createdAt_idx" ON "RewardLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_reversalOfId_key" ON "RewardLedger"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_idempotencyKey_key" ON "RewardLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TemptationBundle_userId_status_idx" ON "TemptationBundle"("userId", "status");

-- CreateIndex
CREATE INDEX "TemptationBundle_habitId_idx" ON "TemptationBundle"("habitId");

-- CreateIndex
CREATE INDEX "StreakFreeze_userId_date_idx" ON "StreakFreeze"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StreakFreeze_habitId_date_key" ON "StreakFreeze"("habitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HabitRewardAllocation_completionId_key" ON "HabitRewardAllocation"("completionId");

-- CreateIndex
CREATE INDEX "HabitRewardAllocation_userId_createdAt_idx" ON "HabitRewardAllocation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardItem_key_key" ON "RewardItem"("key");

-- CreateIndex
CREATE INDEX "RewardRedemption_userId_idx" ON "RewardRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_userId_itemId_key" ON "RewardRedemption"("userId", "itemId");

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

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "RewardLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemptationBundle" ADD CONSTRAINT "TemptationBundle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemptationBundle" ADD CONSTRAINT "TemptationBundle_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreeze" ADD CONSTRAINT "StreakFreeze_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakFreeze" ADD CONSTRAINT "StreakFreeze_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitRewardAllocation" ADD CONSTRAINT "HabitRewardAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitRewardAllocation" ADD CONSTRAINT "HabitRewardAllocation_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

