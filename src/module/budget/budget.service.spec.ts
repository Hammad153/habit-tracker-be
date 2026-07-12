import { BadRequestException } from '@nestjs/common';
import { BudgetService } from './budget.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

const category = {
  id: 'cat-food',
  name: 'Food',
  color: '#F97316',
  icon: 'fast-food-outline',
};

const budget = (patch: Partial<any> = {}) => ({
  id: patch.id ?? 'budget-month',
  userId: 'user-1',
  title: patch.title ?? 'July Budget',
  amount: patch.amount ?? 1000,
  note: null,
  periodType: patch.periodType ?? 'MONTHLY',
  startDate: patch.startDate ?? d('2026-07-01'),
  endDate: patch.endDate ?? d('2026-07-31'),
  expenses: patch.expenses ?? [],
  breakdowns: patch.breakdowns ?? [],
  allocations: patch.allocations ?? [],
  createdAt: patch.createdAt ?? d('2026-07-01'),
  updatedAt: patch.updatedAt ?? d('2026-07-01'),
});

describe('BudgetService', () => {
  const makeService = (overrides: Partial<any> = {}) => {
    const database = {
      budget: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      expenseCategory: {
        findFirst: jest.fn().mockResolvedValue(category),
      },
      expense: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'expense-1', ...data })),
      },
      ...overrides,
    };
    return { service: new BudgetService(database as any), database };
  };

  it('automatically links an expense to the narrowest matching budget', async () => {
    const monthly = budget({ id: 'monthly', periodType: 'MONTHLY' });
    const weekly = budget({
      id: 'weekly',
      periodType: 'WEEKLY',
      startDate: d('2026-07-06'),
      endDate: d('2026-07-12'),
    });
    const { service, database } = makeService();
    database.budget.findMany.mockResolvedValue([monthly, weekly]);

    await service.createExpense('user-1', {
      title: 'Groceries',
      amount: 50,
      categoryId: category.id,
      expenseDate: '2026-07-07',
    });

    expect(database.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ budgetId: 'weekly' }),
      }),
    );
  });

  it('rejects an explicit budget outside the expense date range', async () => {
    const { service, database } = makeService();
    database.budget.findFirst.mockResolvedValue(
      budget({
        id: 'june',
        startDate: d('2026-06-01'),
        endDate: d('2026-06-30'),
      }),
    );

    await expect(
      service.createExpense('user-1', {
        title: 'Groceries',
        amount: 50,
        categoryId: category.id,
        budgetId: 'june',
        expenseDate: '2026-07-07',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('separates budgeted expenses, unbudgeted expenses, and net cash flow in summary', async () => {
    const { service } = makeService();
    const monthly = budget({ id: 'monthly', periodType: 'MONTHLY', amount: 1000 });
    jest.spyOn(service, 'budgets').mockResolvedValue([monthly] as any);
    jest.spyOn(service, 'expenses').mockResolvedValue([
      {
        id: 'budgeted',
        budgetId: 'monthly',
        amount: 300,
        category,
        expenseDate: d('2026-07-07'),
      },
      {
        id: 'unbudgeted',
        budgetId: null,
        amount: 200,
        category,
        expenseDate: d('2026-07-08'),
      },
    ] as any);
    jest.spyOn(service, 'incomes').mockResolvedValue([
      { id: 'income', amount: 900, incomeDate: d('2026-07-01') },
    ] as any);

    const summary = await service.summary(
      'user-1',
      '2026-07-01',
      '2026-07-31',
    );

    expect(summary.totalBudget).toBe(1000);
    expect(summary.totalExpenses).toBe(500);
    expect(summary.budgetedExpenseTotal).toBe(300);
    expect(summary.unbudgetedExpenseTotal).toBe(200);
    expect(summary.remainingBudget).toBe(700);
    expect(summary.netCashFlow).toBe(400);
    expect(summary.budgetUsagePercentage).toBe(30);
  });
});
