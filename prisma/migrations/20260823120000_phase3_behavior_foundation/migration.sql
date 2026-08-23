-- Phase 3.1: behavioral analytics foundation
-- 1) User.timezone: smallest possible timezone configuration, used only to
--    interpret time-of-day analytics in the user's local time.
-- 2) Completion.createdAt: starts collecting real completion instants for
--    future time-window analysis. Historical rows receive the migration
--    timestamp; their original YYYY-MM-DD dates are NOT modified.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;

-- AlterTable
ALTER TABLE "Completion" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
