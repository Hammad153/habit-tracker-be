import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import {
  BudgetAllocationDto,
  BudgetBreakdownDto,
  CreateBudgetDto,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  CreateIncomeDto,
  EXPENSE_CATEGORIES,
  UpdateBudgetDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/budget.dto';

const BUDGET_INCLUDE = {
  expenses: { include: { category: true } },
  breakdowns: { orderBy: { sortOrder: 'asc' } },
  allocations: { include: { category: true } },
} satisfies Prisma.BudgetInclude;

// Money is stored as a float, so compare totals with a sub-kobo tolerance
// rather than exactly (0.1 + 0.2 > 0.3 would otherwise reject a valid budget).
const MONEY_EPSILON = 0.005;

const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  Food: { icon: 'fast-food-outline', color: '#F97316' },
  Transport: { icon: 'bus-outline', color: '#2563EB' },
  Bills: { icon: 'receipt-outline', color: '#DC2626' },
  Health: { icon: 'medical-outline', color: '#16A34A' },
  Education: { icon: 'school-outline', color: '#7C3AED' },
  Savings: { icon: 'wallet-outline', color: '#059669' },
  Entertainment: { icon: 'game-controller-outline', color: '#DB2777' },
  Others: { icon: 'apps-outline', color: '#64748B' },
};

@Injectable()
export class BudgetService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private parseDate(value?: string, fallback?: Date) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date supplied');
    }
    return date;
  }

  private dateWhere(startDate?: string, endDate?: string) {
    const gte = this.parseDate(startDate);
    const lte = this.parseDate(endDate);
    return gte || lte ? { gte, lte } : undefined;
  }

  private currentMonthWindow() {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }

  private async ensureBudget(userId: string, id?: string) {
    if (!id) return null;
    const budget = await this.databaseSvc.budget.findFirst({ where: { id, userId } });
    if (!budget) throw new NotFoundException(`Budget with ID ${id} not found`);
    return budget;
  }

  private async ensureCategory(userId: string, id: string) {
    const category = await this.databaseSvc.expenseCategory.findFirst({
      where: { id, OR: [{ userId }, { isDefault: true }] },
    });
    if (!category) throw new NotFoundException(`Category with ID ${id} not found`);
    return category;
  }

  private async ensureExpense(userId: string, id: string) {
    const expense = await this.databaseSvc.expense.findFirst({ where: { id, userId } });
    if (!expense) throw new NotFoundException(`Expense with ID ${id} not found`);
    return expense;
  }

  private async ensureIncome(userId: string, id: string) {
    const income = await this.databaseSvc.income.findFirst({ where: { id, userId } });
    if (!income) throw new NotFoundException(`Income with ID ${id} not found`);
    return income;
  }

  private async ensureUserDefaults() {
    await Promise.all(
      EXPENSE_CATEGORIES.map(async (name) => {
        const existing = await this.databaseSvc.expenseCategory.findFirst({
          where: { name, isDefault: true, userId: null },
        });
        if (existing) return existing;
        return this.databaseSvc.expenseCategory.create({
          data: {
            name,
            isDefault: true,
            icon: CATEGORY_META[name].icon,
            color: CATEGORY_META[name].color,
          },
        });
      }),
    );
  }

  async categories(userId: string) {
    await this.ensureUserDefaults();
    return this.databaseSvc.expenseCategory.findMany({
      where: { OR: [{ userId }, { isDefault: true }] },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createCategory(userId: string, data: CreateExpenseCategoryDto) {
    return this.databaseSvc.expenseCategory.create({
      data: { ...data, userId, isDefault: false },
    });
  }

  async updateCategory(userId: string, id: string, data: UpdateExpenseCategoryDto) {
    const category = await this.databaseSvc.expenseCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException(`Category with ID ${id} not found`);
    return this.databaseSvc.expenseCategory.update({ where: { id }, data });
  }

  async deleteCategory(userId: string, id: string) {
    const category = await this.databaseSvc.expenseCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException(`Category with ID ${id} not found`);
    return this.databaseSvc.expenseCategory.delete({ where: { id } });
  }

  async budgets(userId: string, startDate?: string, endDate?: string) {
    const range = this.dateWhere(startDate, endDate);
    const where: Prisma.BudgetWhereInput = { userId };
    if (range) {
      where.AND = [{ startDate: { lte: range.lte } }, { endDate: { gte: range.gte } }];
    }
    return this.databaseSvc.budget.findMany({
      where,
      include: BUDGET_INCLUDE,
      orderBy: { startDate: 'desc' },
    });
  }

  private async ensureCategories(userId: string, categoryIds: string[]) {
    await Promise.all(categoryIds.map((id) => this.ensureCategory(userId, id)));
  }

  /**
   * Applies the period-specific rules and returns the values that actually get
   * persisted. For WEEKLY the parent `amount` is derived from the week rows so
   * the stored total can never drift from the breakdown the user typed.
   */
  private normalizeBudget(input: {
    periodType: string;
    amount: number;
    startDate: Date;
    endDate: Date;
    breakdowns?: BudgetBreakdownDto[];
    allocations?: BudgetAllocationDto[];
  }) {
    const { periodType, startDate, endDate } = input;
    if (endDate < startDate) {
      throw new BadRequestException('Budget end date must be after start date');
    }

    // Week rows only make sense for a weekly budget; switching period drops them.
    const breakdowns = periodType === 'WEEKLY' ? (input.breakdowns ?? []) : [];
    let amount = input.amount;

    if (periodType === 'WEEKLY') {
      if (!breakdowns.length) {
        throw new BadRequestException('A weekly budget needs at least one week');
      }
      breakdowns.forEach((week) => {
        if (!(week.amount > 0)) {
          throw new BadRequestException(`${week.label} needs an amount greater than 0`);
        }
        const weekStart = this.parseDate(week.startDate)!;
        const weekEnd = this.parseDate(week.endDate)!;
        if (weekEnd < weekStart) {
          throw new BadRequestException(`${week.label} has an invalid date range`);
        }
      });
      amount = breakdowns.reduce((sum, week) => sum + week.amount, 0);
    }

    if (!(amount > 0)) {
      throw new BadRequestException('Budget amount must be greater than 0');
    }

    const allocations = input.allocations ?? [];
    if (allocations.length) {
      const unique = new Set(allocations.map((item) => item.categoryId));
      if (unique.size !== allocations.length) {
        throw new BadRequestException('A category can only be allocated once per budget');
      }
      allocations.forEach((item) => {
        if (!(item.amount > 0)) {
          throw new BadRequestException('Each category allocation must be greater than 0');
        }
      });
      const allocated = allocations.reduce((sum, item) => sum + item.amount, 0);
      if (allocated - amount > MONEY_EPSILON) {
        throw new BadRequestException(
          'Category allocations exceed the total budget amount',
        );
      }
    }

    return { amount, breakdowns, allocations };
  }

  private breakdownRows(breakdowns: BudgetBreakdownDto[]) {
    return breakdowns.map((week, index) => ({
      label: week.label,
      startDate: this.parseDate(week.startDate)!,
      endDate: this.parseDate(week.endDate)!,
      amount: week.amount,
      note: week.note?.trim() || null,
      sortOrder: index,
    }));
  }

  private allocationRows(allocations: BudgetAllocationDto[]) {
    return allocations.map((item) => ({
      categoryId: item.categoryId,
      amount: item.amount,
    }));
  }

  private normalizeNote(note?: string) {
    if (note === undefined) return undefined;
    return note.trim() || null;
  }

  async createBudget(userId: string, data: CreateBudgetDto) {
    const startDate = this.parseDate(data.startDate)!;
    const endDate = this.parseDate(data.endDate)!;
    const { amount, breakdowns, allocations } = this.normalizeBudget({
      periodType: data.periodType,
      amount: data.amount,
      startDate,
      endDate,
      breakdowns: data.breakdowns,
      allocations: data.allocations,
    });
    await this.ensureCategories(userId, allocations.map((item) => item.categoryId));

    return this.databaseSvc.budget.create({
      data: {
        userId,
        title: data.title,
        note: this.normalizeNote(data.note) ?? null,
        periodType: data.periodType as any,
        amount,
        startDate,
        endDate,
        breakdowns: { create: this.breakdownRows(breakdowns) },
        allocations: { create: this.allocationRows(allocations) },
      },
      include: BUDGET_INCLUDE,
    });
  }

  async updateBudget(userId: string, id: string, data: UpdateBudgetDto) {
    await this.ensureBudget(userId, id);
    const existing = await this.databaseSvc.budget.findUniqueOrThrow({
      where: { id },
      include: { breakdowns: { orderBy: { sortOrder: 'asc' } }, allocations: true },
    });

    // A PATCH may omit any field, so fall back to what is already stored before
    // re-running the period rules against the merged result.
    const periodType = data.periodType ?? existing.periodType;
    const startDate = this.parseDate(data.startDate, existing.startDate)!;
    const endDate = this.parseDate(data.endDate, existing.endDate)!;
    const breakdowns =
      data.breakdowns ??
      existing.breakdowns.map((week) => ({
        label: week.label,
        startDate: week.startDate.toISOString(),
        endDate: week.endDate.toISOString(),
        amount: week.amount,
        note: week.note ?? undefined,
      }));
    const allocations =
      data.allocations ??
      existing.allocations.map((item) => ({
        categoryId: item.categoryId,
        amount: item.amount,
      }));

    const normalized = this.normalizeBudget({
      periodType,
      amount: data.amount ?? existing.amount,
      startDate,
      endDate,
      breakdowns,
      allocations,
    });
    await this.ensureCategories(
      userId,
      normalized.allocations.map((item) => item.categoryId),
    );

    return this.databaseSvc.budget.update({
      where: { id },
      data: {
        title: data.title,
        note: this.normalizeNote(data.note),
        periodType: periodType as any,
        amount: normalized.amount,
        startDate,
        endDate,
        // Child rows are replaced wholesale so the stored set always matches
        // the period that is being saved.
        breakdowns: {
          deleteMany: {},
          create: this.breakdownRows(normalized.breakdowns),
        },
        allocations: {
          deleteMany: {},
          create: this.allocationRows(normalized.allocations),
        },
      },
      include: BUDGET_INCLUDE,
    });
  }

  async deleteBudget(userId: string, id: string) {
    await this.ensureBudget(userId, id);
    return this.databaseSvc.budget.delete({ where: { id } });
  }

  async expenses(userId: string, startDate?: string, endDate?: string) {
    const range = this.dateWhere(startDate, endDate);
    return this.databaseSvc.expense.findMany({
      where: { userId, expenseDate: range },
      include: { category: true, budget: true },
      orderBy: { expenseDate: 'desc' },
    });
  }

  async createExpense(userId: string, data: CreateExpenseDto) {
    await this.ensureBudget(userId, data.budgetId);
    await this.ensureCategory(userId, data.categoryId);
    return this.databaseSvc.expense.create({
      data: {
        ...data,
        userId,
        expenseDate: this.parseDate(data.expenseDate)!,
      },
      include: { category: true, budget: true },
    });
  }

  async updateExpense(userId: string, id: string, data: UpdateExpenseDto) {
    await this.ensureExpense(userId, id);
    await this.ensureBudget(userId, data.budgetId);
    if (data.categoryId) await this.ensureCategory(userId, data.categoryId);
    return this.databaseSvc.expense.update({
      where: { id },
      data: { ...data, expenseDate: this.parseDate(data.expenseDate) },
      include: { category: true, budget: true },
    });
  }

  async deleteExpense(userId: string, id: string) {
    await this.ensureExpense(userId, id);
    return this.databaseSvc.expense.delete({ where: { id } });
  }

  async incomes(userId: string, startDate?: string, endDate?: string) {
    const range = this.dateWhere(startDate, endDate);
    return this.databaseSvc.income.findMany({
      where: { userId, incomeDate: range },
      orderBy: { incomeDate: 'desc' },
    });
  }

  async createIncome(userId: string, data: CreateIncomeDto) {
    return this.databaseSvc.income.create({
      data: { ...data, userId, incomeDate: this.parseDate(data.incomeDate)! },
    });
  }

  async updateIncome(userId: string, id: string, data: UpdateIncomeDto) {
    await this.ensureIncome(userId, id);
    return this.databaseSvc.income.update({
      where: { id },
      data: { ...data, incomeDate: this.parseDate(data.incomeDate) },
    });
  }

  async deleteIncome(userId: string, id: string) {
    await this.ensureIncome(userId, id);
    return this.databaseSvc.income.delete({ where: { id } });
  }

  async summary(userId: string, startDate?: string, endDate?: string) {
    const fallback = this.currentMonthWindow();
    const start = this.parseDate(startDate, fallback.start)!;
    const end = this.parseDate(endDate, fallback.end)!;
    const [budgets, expenses, incomes] = await Promise.all([
      this.budgets(userId, start.toISOString(), end.toISOString()),
      this.expenses(userId, start.toISOString(), end.toISOString()),
      this.incomes(userId, start.toISOString(), end.toISOString()),
    ]);
    const totalBudget = budgets.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
    const byCategory = expenses.reduce<Record<string, { total: number; color?: string; icon?: string }>>((acc, item) => {
      const key = item.category?.name || 'Others';
      acc[key] = acc[key] || { total: 0, color: item.category?.color, icon: item.category?.icon };
      acc[key].total += item.amount;
      return acc;
    }, {});
    const budgetUsagePercentage = totalBudget > 0 ? Math.round((totalExpenses / totalBudget) * 100) : 0;
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalBudget,
      totalIncome,
      totalExpenses,
      remainingBalance: totalIncome - totalExpenses,
      remainingBudget: totalBudget - totalExpenses,
      budgetUsagePercentage,
      warning:
        totalBudget <= 0
          ? null
          : budgetUsagePercentage >= 100
            ? 'You are above your budget for this period.'
            : budgetUsagePercentage >= 80
              ? 'You are close to your budget limit.'
              : null,
      budgets,
      categoryBreakdown: Object.entries(byCategory).map(([category, value]) => ({
        category,
        ...value,
      })),
      recentExpenses: expenses.slice(0, 5),
      recentIncome: incomes.slice(0, 5),
    };
  }
}
