import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../core/database/database.service';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private databaseSvc: DatabaseService) {}

  @Get('overview')
  async getOverview(@Query('userId') userId: string) {
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false },
      include: { completions: true },
    });

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    // Calculate stats
    const allCompletions = habits.flatMap((h) => h.completions);
    const last30DaysCompletions = allCompletions.filter(
      (c) => c.status && new Date(c.date) >= thirtyDaysAgo,
    );
    const last7DaysCompletions = allCompletions.filter(
      (c) => c.status && new Date(c.date) >= sevenDaysAgo,
    );

    // Weekly completion rate
    const totalPossible7Days = habits.length * 7;
    const weeklyRate =
      totalPossible7Days > 0
        ? Math.round((last7DaysCompletions.length / totalPossible7Days) * 100)
        : 0;

    // Monthly completion rate
    const totalPossible30Days = habits.length * 30;
    const monthlyRate =
      totalPossible30Days > 0
        ? Math.round(
            (last30DaysCompletions.length / totalPossible30Days) * 100,
          )
        : 0;

    // Best day of week
    const dayStats = [0, 0, 0, 0, 0, 0, 0]; // Sun to Sat
    last30DaysCompletions.forEach((c) => {
      const day = new Date(c.date).getDay();
      dayStats[day]++;
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bestDayIndex = dayStats.indexOf(Math.max(...dayStats));

    // Best streak per habit
    const habitStreaks = habits.map((h) => {
      const sorted = h.completions
        .filter((c) => c.status)
        .map((c) => c.date)
        .sort();

      let maxStreak = 0;
      let currentStreak = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0) {
          currentStreak = 1;
        } else {
          const prev = new Date(sorted[i - 1]);
          const curr = new Date(sorted[i]);
          const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
          currentStreak = diff === 1 ? currentStreak + 1 : 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
      }

      return {
        habitId: h.id,
        habitTitle: h.title,
        icon: h.icon,
        iconColor: h.iconColor,
        longestStreak: maxStreak,
        totalCompletions: h.completions.filter((c) => c.status).length,
        completionRate:
          h.completions.length > 0
            ? Math.round(
                (h.completions.filter((c) => c.status).length /
                  30) *
                  100,
              )
            : 0,
      };
    });

    // Daily completions for chart (last 30 days)
    const dailyData: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = allCompletions.filter(
        (c) => c.date === dateStr && c.status,
      ).length;
      dailyData.push({ date: dateStr, count });
    }

    // Category breakdown
    const categoryMap: Record<
      string,
      { count: number; completions: number }
    > = {};
    habits.forEach((h) => {
      const cat = h.category || 'Uncategorized';
      if (!categoryMap[cat]) categoryMap[cat] = { count: 0, completions: 0 };
      categoryMap[cat].count++;
      categoryMap[cat].completions += h.completions.filter(
        (c) => c.status,
      ).length;
    });

    return {
      totalHabits: habits.length,
      weeklyCompletionRate: weeklyRate,
      monthlyCompletionRate: monthlyRate,
      bestDay: dayNames[bestDayIndex],
      dayDistribution: dayNames.map((name, i) => ({
        day: name,
        count: dayStats[i],
      })),
      habitStreaks: habitStreaks.sort(
        (a, b) => b.totalCompletions - a.totalCompletions,
      ),
      dailyCompletions: dailyData,
      categoryBreakdown: Object.entries(categoryMap).map(
        ([name, data]) => ({
          category: name,
          ...data,
        }),
      ),
    };
  }
}
