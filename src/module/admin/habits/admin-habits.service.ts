import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

export class AdminHabitsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  isArchived?: boolean | string;
}

@Injectable()
export class AdminHabitsService {
  constructor(private readonly db: DatabaseService) {}

  async getHabits(query: AdminHabitsQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.category) {
      where.category = query.category;
    }

    if (query.isArchived !== undefined && query.isArchived !== '') {
      where.isArchived = String(query.isArchived) === 'true';
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { subtitle: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [habits, total] = await Promise.all([
      this.db.habit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              completions: true,
            },
          },
        },
      }),
      this.db.habit.count({ where }),
    ]);

    const formattedHabits = habits.map((h) => ({
      id: h.id,
      title: h.title,
      subtitle: h.subtitle,
      category: h.category,
      frequency: h.frequency,
      scheduleType: h.scheduleType,
      isArchived: h.isArchived,
      createdAt: h.createdAt,
      completionsCount: h._count.completions,
      user: h.user,
    }));

    return {
      items: formattedHabits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getHabitDetail(habitId: string) {
    const habit = await this.db.habit.findUnique({
      where: { id: habitId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        completions: {
          orderBy: { date: 'desc' },
          take: 30,
        },
      },
    });

    if (!habit) {
      throw new NotFoundException(`Habit with ID ${habitId} not found`);
    }

    const totalCompletions = await this.db.completion.count({
      where: { habitId },
    });

    const completionBreakdown = await this.db.completion.groupBy({
      by: ['kind'],
      where: { habitId },
      _count: {
        _all: true,
      },
    });

    const kindCounts = completionBreakdown.reduce(
      (acc, item) => {
        acc[item.kind] = item._count._all;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      habit: {
        id: habit.id,
        title: habit.title,
        subtitle: habit.subtitle,
        category: habit.category,
        frequency: habit.frequency,
        scheduleType: habit.scheduleType,
        isArchived: habit.isArchived,
        createdAt: habit.createdAt,
        user: habit.user,
      },
      stats: {
        totalCompletions,
        kindCounts,
      },
      recentCompletions: habit.completions,
    };
  }
}
