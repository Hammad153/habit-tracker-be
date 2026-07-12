CREATE INDEX IF NOT EXISTS "Budget_userId_periodType_startDate_endDate_idx" ON "Budget"("userId", "periodType", "startDate", "endDate");
CREATE INDEX IF NOT EXISTS "Expense_userId_budgetId_expenseDate_idx" ON "Expense"("userId", "budgetId", "expenseDate");
