CREATE TYPE "BudgetPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');
CREATE TYPE "DailyPlanTaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "DailyPlanTaskStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "Budget" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "periodType" "BudgetPeriodType" NOT NULL DEFAULT 'MONTHLY',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseCategory" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "color" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "budgetId" TEXT,
  "categoryId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Income" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "incomeDate" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyPlan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planDate" TIMESTAMP(3) NOT NULL,
  "title" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyPlanTask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dailyPlanId" TEXT NOT NULL,
  "habitId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" "DailyPlanTaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "DailyPlanTaskStatus" NOT NULL DEFAULT 'PENDING',
  "startTime" TEXT,
  "endTime" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyPlanTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Budget_userId_startDate_endDate_idx" ON "Budget"("userId", "startDate", "endDate");
CREATE UNIQUE INDEX "ExpenseCategory_userId_name_key" ON "ExpenseCategory"("userId", "name");
CREATE INDEX "ExpenseCategory_isDefault_idx" ON "ExpenseCategory"("isDefault");
CREATE INDEX "Expense_userId_expenseDate_idx" ON "Expense"("userId", "expenseDate");
CREATE INDEX "Expense_budgetId_idx" ON "Expense"("budgetId");
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");
CREATE INDEX "Income_userId_incomeDate_idx" ON "Income"("userId", "incomeDate");
CREATE UNIQUE INDEX "DailyPlan_userId_planDate_key" ON "DailyPlan"("userId", "planDate");
CREATE INDEX "DailyPlan_userId_planDate_idx" ON "DailyPlan"("userId", "planDate");
CREATE INDEX "DailyPlanTask_userId_idx" ON "DailyPlanTask"("userId");
CREATE INDEX "DailyPlanTask_dailyPlanId_sortOrder_idx" ON "DailyPlanTask"("dailyPlanId", "sortOrder");
CREATE INDEX "DailyPlanTask_habitId_idx" ON "DailyPlanTask"("habitId");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Income" ADD CONSTRAINT "Income_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_dailyPlanId_fkey" FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
