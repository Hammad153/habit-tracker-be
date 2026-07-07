import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import {
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
      EXPENSE_CATEGORIES.map((name) =>
        this.databaseSvc.expenseCategory.upsert({
          where: { userId_name: { userId: null, name } },
          update: {},
          create: {
            name,
            isDefault: true,
            icon: CATEGORY_META[name].icon,
            color: CATEGORY_META[name].color,
          },
        }),
      ),
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
      include: { expenses: { include: { category: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async createBudget(userId: string, data: CreateBudgetDto) {
    const startDate = this.parseDate(data.startDate)!;
    const endDate = this.parseDate(data.endDate)!;
    if (endDate < startDate) throw new BadRequestException('Budget end date must be after start date');
    return this.databaseSvc.budget.create({
      data: { ...data, userId, startDate, endDate, periodType: data.periodType as any },
    });
  }

  async updateBudget(userId: string, id: string, data: UpdateBudgetDto) {
    await this.ensureBudget(userId, id);
    const startDate = this.parseDate(data.startDate);
    const endDate = this.parseDate(data.endDate);
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('Budget end date must be after start date');
    }
    return this.databaseSvc.budget.update({
      where: { id },
      data: { ...data, startDate, endDate, periodType: data.periodType as any },
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
