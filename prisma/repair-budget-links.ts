import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERIOD_PRIORITY: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 2,
  CUSTOM: 3,
  MONTHLY: 4,
};

const dayStart = (date: Date) => {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
};

const dayEnd = (date: Date) => {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
};

const contains = (
  budget: { startDate: Date; endDate: Date },
  expenseDate: Date,
) => expenseDate >= dayStart(budget.startDate) && expenseDate <= dayEnd(budget.endDate);

const durationDays = (budget: { startDate: Date; endDate: Date }) =>
  Math.max(
    1,
    Math.ceil(
      (dayEnd(budget.endDate).getTime() - dayStart(budget.startDate).getTime() + 1) /
        86400000,
    ),
  );

async function resolveBudget(userId: string, expenseDate: Date) {
  const candidates = (
    await prisma.budget.findMany({
      where: {
        userId,
        startDate: { lte: expenseDate },
        endDate: { gte: expenseDate },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'asc' }],
    })
  )
    .filter((budget) => contains(budget, expenseDate))
    .sort((a, b) => {
      const duration = durationDays(a) - durationDays(b);
      if (duration !== 0) return duration;
      const priority = PERIOD_PRIORITY[a.periodType] - PERIOD_PRIORITY[b.periodType];
      if (priority !== 0) return priority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  if (!candidates.length) return { budget: null, ambiguous: false };
  const [first, second] = candidates;
  if (
    second &&
    durationDays(first) === durationDays(second) &&
    PERIOD_PRIORITY[first.periodType] === PERIOD_PRIORITY[second.periodType]
  ) {
    return { budget: null, ambiguous: true };
  }
  return { budget: first, ambiguous: false };
}

async function main() {
  const stats = {
    validExistingLinks: 0,
    repairedLinks: 0,
    newlyLinkedExpenses: 0,
    clearedInvalidLinks: 0,
    unresolvedAmbiguousExpenses: 0,
    unchangedUnbudgetedExpenses: 0,
  };
  const ambiguous: string[] = [];

  const expenses = await prisma.expense.findMany({
    include: { budget: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const expense of expenses) {
    const hasValidExistingLink =
      expense.budget &&
      expense.budget.userId === expense.userId &&
      contains(expense.budget, expense.expenseDate);

    if (hasValidExistingLink) {
      stats.validExistingLinks += 1;
      continue;
    }

    const resolved = await resolveBudget(expense.userId, expense.expenseDate);
    if (resolved.ambiguous) {
      ambiguous.push(expense.id);
      stats.unresolvedAmbiguousExpenses += 1;
      continue;
    }

    const nextBudgetId = resolved.budget?.id ?? null;
    if (!nextBudgetId && expense.budgetId) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { budgetId: null },
      });
      stats.clearedInvalidLinks += 1;
      continue;
    }

    if (!nextBudgetId) {
      stats.unchangedUnbudgetedExpenses += 1;
      continue;
    }

    await prisma.expense.update({
      where: { id: expense.id },
      data: { budgetId: nextBudgetId },
    });
    if (expense.budgetId) {
      stats.repairedLinks += 1;
    } else {
      stats.newlyLinkedExpenses += 1;
    }
  }

  console.log(JSON.stringify({ ...stats, ambiguous }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
