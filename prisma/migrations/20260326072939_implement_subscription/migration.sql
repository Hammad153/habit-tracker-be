-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pushToken" TEXT;

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "intervalDays" INTEGER,
ADD COLUMN     "scheduleDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scheduleType" TEXT,
ADD COLUMN     "timesPerWeek" INTEGER;

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

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_habitId_key" ON "Reminder"("habitId");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
