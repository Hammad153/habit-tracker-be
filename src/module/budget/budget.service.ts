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
  BUDGET_PERIOD_TYPES,
  BudgetSummaryScope,
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
const PERIOD_PRIORITY: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 2,
  CUSTOM: 3,
  MONTHLY: 4,
};

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

  private dayStart(date: Date) {
    const next = new Date(date);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }

  private dayEnd(date: Date) {
    const next = new Date(date);
    next.setUTCHours(23, 59, 59, 999);
    return next;
  }

  private budgetContainsDate(
    budget: { startDate: Date; endDate: Date },
    date: Date,
  ) {
    return date >= this.dayStart(budget.startDate) && date <= this.dayEnd(budget.endDate);
  }

  private budgetDurationDays(budget: { startDate: Date; endDate: Date }) {
    return Math.max(
      1,
      Math.ceil(
        (this.dayEnd(budget.endDate).getTime() -
          this.dayStart(budget.startDate).getTime() +
          1) /
          86400000,
      ),
    );
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

  private async assertNoSameScopeOverlap(
    userId: string,
    input: {
      periodType: string;
      startDate: Date;
      endDate: Date;
      excludeBudgetId?: string;
    },
  ) {
    const conflict = await this.databaseSvc.budget.findFirst({
      where: {
        userId,
        periodType: input.periodType as any,
        id: input.excludeBudgetId ? { not: input.excludeBudgetId } : undefined,
        startDate: { lte: this.dayEnd(input.endDate) },
        endDate: { gte: this.dayStart(input.startDate) },
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `A ${input.periodType.toLowerCase()} budget already overlaps this period`,
      );
    }
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

  /**
   * Seeds the shared default categories once. This runs on every `categories()`
   * call, so it costs a single SELECT and writes nothing in the common case.
   *
   * The missing names are computed here rather than relying on `skipDuplicates`:
   * the unique index is on (userId, name), and Postgres treats NULL userIds as
   * distinct, so duplicate defaults would slip through.
   */
  private async ensureUserDefaults() {
    const existing = await this.databaseSvc.expenseCategory.findMany({
      where: { isDefault: true, userId: null },
      select: { name: true },
    });
    const present = new Set(existing.map((category) => category.name));
    const missing = EXPENSE_CATEGORIES.filter((name) => !present.has(name));
    if (!missing.length) return;

    await this.databaseSvc.expenseCategory.createMany({
      data: missing.map((name) => ({
        name,
        isDefault: true,
        icon: CATEGORY_META[name].icon,
        color: CATEGORY_META[name].color,
      })),
    });
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
    const budgets = await this.databaseSvc.budget.findMany({
      where,
      include: BUDGET_INCLUDE,
      orderBy: { startDate: 'desc' },
    });
    return Promise.all(budgets.map((budget) => this.withBudgetCalculations(userId, budget)));
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
    await this.assertNoSameScopeOverlap(userId, {
      periodType: data.periodType,
      startDate,
      endDate,
    });

    const budget = await this.databaseSvc.budget.create({
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
    return this.withBudgetCalculations(userId, budget);
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
    await this.assertNoSameScopeOverlap(userId, {
      periodType,
      startDate,
      endDate,
      excludeBudgetId: id,
    });

    const updated = await this.databaseSvc.$transaction(async (tx) => {
      const budget = await tx.budget.update({
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
      const affected = await tx.expense.findMany({ where: { userId, budgetId: id } });
      for (const expense of affected) {
        if (!this.budgetContainsDate(budget, expense.expenseDate)) {
          const nextBudget = await this.resolveBudgetForExpense({
            userId,
            expenseDate: expense.expenseDate,
            db: tx,
          });
          await tx.expense.update({
            where: { id: expense.id },
            data: { budgetId: nextBudget?.id ?? null },
          });
        }
      }
      return budget;
    });
    return this.withBudgetCalculations(userId, updated);
  }

  async deleteBudget(userId: string, id: string) {
    await this.ensureBudget(userId, id);
    return this.databaseSvc.$transaction(async (tx) => {
      const affected = await tx.expense.findMany({ where: { userId, budgetId: id } });
      const deleted = await tx.budget.delete({ where: { id } });
      for (const expense of affected) {
        const nextBudget = await this.resolveBudgetForExpense({
          userId,
          expenseDate: expense.expenseDate,
          db: tx,
        });
        await tx.expense.update({
          where: { id: expense.id },
          data: { budgetId: nextBudget?.id ?? null },
        });
      }
      return deleted;
    });
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
    const expenseDate = this.parseDate(data.expenseDate)!;
    const budget = await this.resolveBudgetForExpense({
      userId,
      expenseDate,
      requestedBudgetId: data.budgetId,
    });
    await this.ensureCategory(userId, data.categoryId);
    return this.databaseSvc.expense.create({
      data: {
        ...data,
        userId,
        budgetId: budget?.id ?? null,
        expenseDate,
      },
      include: { category: true, budget: true },
    });
  }

  async updateExpense(userId: string, id: string, data: UpdateExpenseDto) {
    const existing = await this.ensureExpense(userId, id);
    const expenseDate = this.parseDate(data.expenseDate, existing.expenseDate)!;
    const budget = await this.resolveBudgetForExpense({
      userId,
      expenseDate,
      requestedBudgetId: data.budgetId,
    });
    if (data.categoryId) await this.ensureCategory(userId, data.categoryId);
    return this.databaseSvc.expense.update({
      where: { id },
      data: { ...data, budgetId: budget?.id ?? null, expenseDate },
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

  private async resolveBudgetForExpense({
    userId,
    expenseDate,
    requestedBudgetId,
    db = this.databaseSvc,
  }: {
    userId: string;
    expenseDate: Date;
    requestedBudgetId?: string | null;
    db?: any;
  }) {
    if (requestedBudgetId) {
      const requested = await db.budget.findFirst({
        where: { id: requestedBudgetId, userId },
      });
      if (!requested) {
        throw new NotFoundException(`Budget with ID ${requestedBudgetId} not found`);
      }
      if (!this.budgetContainsDate(requested, expenseDate)) {
        throw new BadRequestException(
          'Expense date falls outside the selected budget period',
        );
      }
      return requested;
    }

    const candidates = await db.budget.findMany({
      where: {
        userId,
        startDate: { lte: expenseDate },
        endDate: { gte: expenseDate },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'asc' }],
    });
    if (!candidates.length) return null;

    const ranked = candidates
      .filter((budget) => this.budgetContainsDate(budget, expenseDate))
      .sort((a, b) => {
        const duration = this.budgetDurationDays(a) - this.budgetDurationDays(b);
        if (duration !== 0) return duration;
        const priority = PERIOD_PRIORITY[a.periodType] - PERIOD_PRIORITY[b.periodType];
        if (priority !== 0) return priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    if (!ranked.length) return null;

    const first = ranked[0];
    const second = ranked[1];
    if (
      second &&
      this.budgetDurationDays(first) === this.budgetDurationDays(second) &&
      PERIOD_PRIORITY[first.periodType] === PERIOD_PRIORITY[second.periodType]
    ) {
      return null;
    }
    return first;
  }

  private async withBudgetCalculations(userId: string, budget: any) {
    const start = this.dayStart(budget.startDate);
    const end = this.dayEnd(budget.endDate);
    const [periodIncome, periodExpenses] = await Promise.all([
      this.databaseSvc.income.aggregate({
        where: { userId, incomeDate: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.databaseSvc.expense.findMany({
        where: { userId, expenseDate: { gte: start, lte: end } },
        include: { category: true },
      }),
    ]);
    const linkedExpenses: any[] = budget.expenses ?? [];
    const budgetedExpenseTotal = linkedExpenses.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const totalPeriodExpenses = periodExpenses.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const incomeTotal = periodIncome._sum.amount ?? 0;
    const categoryBreakdown = linkedExpenses.reduce<Record<string, any>>(
      (acc, item) => {
        const key = item.categoryId || 'uncategorized';
        acc[key] = acc[key] || {
          categoryId: item.categoryId,
          category: item.category?.name || 'Uncategorized',
          total: 0,
          color: item.category?.color,
          icon: item.category?.icon,
        };
        acc[key].total += item.amount;
        return acc;
      },
      {},
    );
    const dailyBreakdown = linkedExpenses.reduce<Record<string, number>>((acc, item) => {
      const key = item.expenseDate.toISOString().slice(0, 10);
      acc[key] = (acc[key] ?? 0) + item.amount;
      return acc;
    }, {});
    const weeklyBreakdown = (budget.breakdowns ?? []).map((week) => {
      const weekStart = this.dayStart(week.startDate);
      const weekEnd = this.dayEnd(week.endDate);
      const spent = linkedExpenses
        .filter((expense) => expense.expenseDate >= weekStart && expense.expenseDate <= weekEnd)
        .reduce((sum, expense) => sum + expense.amount, 0);
      return {
        ...week,
        spent,
        remainingAmount: week.amount - spent,
        utilisationPercentage:
          week.amount > 0 ? Math.round((spent / week.amount) * 100) : 0,
      };
    });

    return {
      ...budget,
      plannedAmount: budget.amount,
      budgetedExpenseTotal,
      remainingAmount: budget.amount - budgetedExpenseTotal,
      utilisationPercentage:
        budget.amount > 0 ? Math.round((budgetedExpenseTotal / budget.amount) * 100) : 0,
      overspentAmount: Math.max(budgetedExpenseTotal - budget.amount, 0),
      periodIncome: incomeTotal,
      totalPeriodExpenses,
      netCashFlow: incomeTotal - totalPeriodExpenses,
      categoryBreakdown: Object.values(categoryBreakdown),
      dailyBreakdown: Object.entries(dailyBreakdown).map(([date, total]) => ({
        date,
        total,
      })),
      weeklyBreakdown,
    };
  }

  private resolveSummaryScope(scope: string | undefined, budgets: any[]): BudgetSummaryScope {
    if (scope && [...BUDGET_PERIOD_TYPES, 'AUTO'].includes(scope as any)) {
      if (scope !== 'AUTO') return scope as BudgetSummaryScope;
    }
    if (budgets.some((budget) => budget.periodType === 'MONTHLY')) return 'MONTHLY';
    if (budgets.some((budget) => budget.periodType === 'WEEKLY')) return 'WEEKLY';
    if (budgets.some((budget) => budget.periodType === 'DAILY')) return 'DAILY';
    return 'AUTO';
  }

  async summary(userId: string, startDate?: string, endDate?: string, scope?: string) {
    const fallback = this.currentMonthWindow();
    const start = this.parseDate(startDate, fallback.start)!;
    const end = this.parseDate(endDate, fallback.end)!;
    const [budgets, expenses, incomes] = await Promise.all([
      this.budgets(userId, start.toISOString(), end.toISOString()),
      this.expenses(userId, start.toISOString(), end.toISOString()),
      this.incomes(userId, start.toISOString(), end.toISOString()),
    ]);
    const selectedScope = this.resolveSummaryScope(scope, budgets);
    const scopedBudgets =
      selectedScope === 'AUTO'
        ? []
        : budgets.filter((budget) => budget.periodType === selectedScope);
    const scopedBudgetIds = new Set(scopedBudgets.map((budget) => budget.id));
    const totalBudget = scopedBudgets.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const budgetedExpenses = expenses.filter((item) =>
      item.budgetId ? scopedBudgetIds.has(item.budgetId) : false,
    );
    const budgetedExpenseTotal = budgetedExpenses.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const unbudgetedExpenseTotal = totalExpenses - budgetedExpenseTotal;
    const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
    const byCategory = budgetedExpenses.reduce<Record<string, { total: number; color?: string; icon?: string }>>((acc, item) => {
      const key = item.category?.name || 'Others';
      acc[key] = acc[key] || { total: 0, color: item.category?.color, icon: item.category?.icon };
      acc[key].total += item.amount;
      return acc;
    }, {});
    const budgetUsagePercentage = totalBudget > 0 ? Math.round((budgetedExpenseTotal / totalBudget) * 100) : 0;
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      scope: selectedScope,
      totalBudget,
      plannedBudget: totalBudget,
      totalIncome,
      totalExpenses,
      budgetedExpenses: budgetedExpenseTotal,
      budgetedExpenseTotal,
      unbudgetedExpenses: unbudgetedExpenseTotal,
      unbudgetedExpenseTotal,
      remainingBalance: totalIncome - totalExpenses,
      netCashFlow: totalIncome - totalExpenses,
      remainingBudget: totalBudget - budgetedExpenseTotal,
      overspentAmount: Math.max(budgetedExpenseTotal - totalBudget, 0),
      budgetUsagePercentage,
      warning:
        totalBudget <= 0
          ? null
          : budgetUsagePercentage >= 100
            ? 'You are above your budget for this period.'
            : budgetUsagePercentage >= 80
              ? 'You are close to your budget limit.'
              : null,
      budgets: scopedBudgets,
      allBudgets: budgets,
      categoryBreakdown: Object.entries(byCategory).map(([category, value]) => ({
        category,
        ...value,
      })),
      recentExpenses: expenses.slice(0, 5),
      recentIncome: incomes.slice(0, 5),
    };
  }
}
