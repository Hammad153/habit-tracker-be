-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "BudgetBreakdown" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCategoryAllocation" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCategoryAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetBreakdown_budgetId_sortOrder_idx" ON "BudgetBreakdown"("budgetId", "sortOrder");

-- CreateIndex
CREATE INDEX "BudgetCategoryAllocation_budgetId_idx" ON "BudgetCategoryAllocation"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCategoryAllocation_budgetId_categoryId_key" ON "BudgetCategoryAllocation"("budgetId", "categoryId");

-- AddForeignKey
ALTER TABLE "BudgetBreakdown" ADD CONSTRAINT "BudgetBreakdown_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCategoryAllocation" ADD CONSTRAINT "BudgetCategoryAllocation_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCategoryAllocation" ADD CONSTRAINT "BudgetCategoryAllocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
