import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { calculateStreaks } from '../../core/utils/streak.utils';

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const SHORT_BY_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_NAME: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export interface AnalyticsOverview {
  totalHabits: number;
  weeklyCompletionRate: number;
  monthlyCompletionRate: number;
  bestDay: string;
  dayDistribution: { day: string; count: number }[];
  habitStreaks: {
    habitId: string;
    habitTitle: string;
    icon: string;
    iconColor: string;
    longestStreak: number;
    totalCompletions: number;
    completionRate: number;
  }[];
  dailyCompletions: { date: string; count: number }[];
  categoryBreakdown: { category: string; count: number; completions: number }[];
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  public async getOverview(userId: string): Promise<AnalyticsOverview> {
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId },
      include: { completions: true },
    });

    const now = Date.now();
    const totalHabits = habits.length;
    const withinDays = (date: string, days: number) =>
      new Date(date).getTime() >= now - days * 86400000;

    // All "completed" entries (status = true) across every habit.
    const completed = habits.flatMap((h) =>
      h.completions.filter((c) => c.status),
    );

    const weeklyDone = completed.filter((c) => withinDays(c.date, 7)).length;
    const monthlyDone = completed.filter((c) => withinDays(c.date, 30)).length;
    const weeklyCompletionRate = totalHabits
      ? Math.min(100, Math.round((weeklyDone / (totalHabits * 7)) * 100))
      : 0;
    const monthlyCompletionRate = totalHabits
      ? Math.min(100, Math.round((monthlyDone / (totalHabits * 30)) * 100))
      : 0;

    // Distribution of completions across weekdays.
    const dayCounts: Record<string, number> = Object.fromEntries(
      DAY_ORDER.map((d) => [d, 0]),
    );
    completed.forEach((c) => {
      const label = SHORT_BY_INDEX[new Date(c.date).getDay()];
      if (dayCounts[label] !== undefined) dayCounts[label] += 1;
    });
    const dayDistribution = DAY_ORDER.map((d) => ({
      day: d,
      count: dayCounts[d],
    }));

    let bestDay = '—';
    if (completed.length > 0) {
      let max = -1;
      for (const d of DAY_ORDER) {
        if (dayCounts[d] > max) {
          max = dayCounts[d];
          bestDay = FULL_NAME[d];
        }
      }
    }

    const habitStreaks = habits
      .map((h) => {
        const doneDates = h.completions
          .filter((c) => c.status)
          .map((c) => c.date);
        const { longestStreak } = calculateStreaks(doneDates);
        const totalCompletions = doneDates.length;
        const daysSince = Math.max(
          1,
          Math.ceil((now - new Date(h.createdAt).getTime()) / 86400000),
        );
        return {
          habitId: h.id,
          habitTitle: h.title,
          icon: h.icon,
          iconColor: h.iconColor,
          longestStreak,
          totalCompletions,
          completionRate: Math.min(
            100,
            Math.round((totalCompletions / daysSince) * 100),
          ),
        };
      })
      .sort((a, b) => b.longestStreak - a.longestStreak);

    const dailyMap: Record<string, number> = {};
    completed.forEach((c) => {
      if (withinDays(c.date, 30)) {
        dailyMap[c.date] = (dailyMap[c.date] || 0) + 1;
      }
    });
    const dailyCompletions = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const catMap: Record<string, { count: number; completions: number }> = {};
    habits.forEach((h) => {
      const category = h.category || 'Uncategorized';
      if (!catMap[category]) catMap[category] = { count: 0, completions: 0 };
      catMap[category].count += 1;
      catMap[category].completions += h.completions.filter(
        (c) => c.status,
      ).length;
    });
    const categoryBreakdown = Object.entries(catMap).map(
      ([category, v]) => ({ category, ...v }),
    );

    return {
      totalHabits,
      weeklyCompletionRate,
      monthlyCompletionRate,
      bestDay,
      dayDistribution,
      habitStreaks,
      dailyCompletions,
      categoryBreakdown,
    };
  }
}
