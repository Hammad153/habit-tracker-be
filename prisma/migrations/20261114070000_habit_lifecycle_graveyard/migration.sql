-- CreateEnum
CREATE TYPE "HabitLifecycleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'COMPLETED', 'BURIED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "lifecycleStatus" "HabitLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- Existing archive records remain ordinary, unclassified archives.
UPDATE "Habit" SET "lifecycleStatus" = 'ARCHIVED' WHERE "isArchived" = true;

-- CreateTable
CREATE TABLE "HabitBurial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "habitCreatedAt" TIMESTAMP(3) NOT NULL,
    "lastCompletedDay" TEXT,
    "totalCompletions" INTEGER NOT NULL,
    "bestStreak" INTEGER NOT NULL,
    "reason" TEXT,
    "epitaph" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'stone',
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "buriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restartHabitId" TEXT,

    CONSTRAINT "HabitBurial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitLifecycleEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "fromState" "HabitLifecycleStatus" NOT NULL,
    "toState" "HabitLifecycleStatus" NOT NULL,
    "commandId" TEXT,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HabitBurial_userId_buriedAt_idx" ON "HabitBurial"("userId", "buriedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HabitBurial_userId_commandId_key" ON "HabitBurial"("userId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "HabitBurial_habitId_sequence_key" ON "HabitBurial"("habitId", "sequence");

-- CreateIndex
CREATE INDEX "HabitLifecycleEvent_habitId_createdAt_idx" ON "HabitLifecycleEvent"("habitId", "createdAt");

-- CreateIndex
CREATE INDEX "HabitLifecycleEvent_userId_createdAt_idx" ON "HabitLifecycleEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HabitBurial" ADD CONSTRAINT "HabitBurial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitBurial" ADD CONSTRAINT "HabitBurial_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLifecycleEvent" ADD CONSTRAINT "HabitLifecycleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLifecycleEvent" ADD CONSTRAINT "HabitLifecycleEvent_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
