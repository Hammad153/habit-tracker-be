-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'BASIC', 'PREMIUM');

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "intervalDays" INTEGER,
ADD COLUMN     "restDays" TEXT[],
ADD COLUMN     "scheduleDays" TEXT[],
ADD COLUMN     "scheduleType" TEXT DEFAULT 'daily',
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "timesPerWeek" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pushToken" TEXT,
ADD COLUMN     "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "days" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "icon" TEXT NOT NULL,
    "iconColor" TEXT NOT NULL,
    "iconBg" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "frequency" TEXT DEFAULT 'Daily',
    "goal" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT DEFAULT 'times',
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HabitTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_habitId_key" ON "Reminder"("habitId");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
