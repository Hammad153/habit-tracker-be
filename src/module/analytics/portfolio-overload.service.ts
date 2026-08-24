import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER } from '../../core/ai/ai-provider.interface';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import { DatabaseService } from '../../core/database/database.service';
import {
  buildBehaviorReport,
} from '../../core/utils/behavior-analytics.utils';
import { BEHAVIOR_WINDOWS } from '../../core/utils/behavior.constants';
import { localDateKeyInZone } from '../../core/utils/week.utils';
import { shiftDayKey } from '../../core/utils/schedule.utils';
import {
  HabitLoadSummary,
  PortfolioOverloadReport,
  buildPortfolioOverloadReport,
} from './portfolio-overload.engine';

const MAX_ACTIVE_HABITS = 50;

/**
 * Phase 3.6 — portfolio overload intelligence.
 *
 * Pool-friendly by design: exactly THREE bounded queries (habits+completions,
 * identity links, user timezone) and then pure in-process analytics via the
 * Phase 3.1 engine. No per-habit IO, no NVIDIA call.
 */
@Injectable()
export class PortfolioOverloadService {
  constructor(
    private readonly databaseSvc: DatabaseService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  public async getOverloadReport(userId: string): Promise<
    PortfolioOverloadReport & {
      insight: { headline: string; message: string; ctaLabel: string };
    }
  > {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const todayKey = localDateKeyInZone(user?.timezone ?? null);
    const windowStart = shiftDayKey(todayKey, -(BEHAVIOR_WINDOWS.LONG - 1));

    // ONE query for all active habits + their 90-day completion facts.
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false },
      select: {
        id: true,
        title: true,
        goal: true,
        scheduleType: true,
        scheduleDays: true,
        timesPerWeek: true,
        intervalDays: true,
        scheduledTime: true,
        startDate: true,
        fullBehavior: true,
        minimumBehavior: true,
        emergencyMinimum: true,
        completions: {
          where: { date: { gte: windowStart }, status: true },
          select: { date: true, value: true, kind: true },
          orderBy: { date: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ACTIVE_HABITS,
    });

    const identityTitlesByHabit =
      await this.loadIdentityTitles(habits.map((h) => h.id));

    const summaries: HabitLoadSummary[] = habits.map((habit) => {
      // Pure Phase 3.1 engine — identical contract, zero extra IO.
      const report = buildBehaviorReport({
        habit: {
          id: habit.id,
          title: habit.title,
          goal: habit.goal,
          scheduleType: habit.scheduleType,
          scheduleDays: habit.scheduleDays,
          timesPerWeek: habit.timesPerWeek,
          intervalDays: habit.intervalDays,
          scheduledTime: habit.scheduledTime,
          startDate: habit.startDate,
        },
        completions: habit.completions.map((c) => ({
          date: c.date,
          status: true,
          value: c.value,
          kind:
            c.kind === 'MINIMUM' || c.kind === 'EMERGENCY' ? c.kind : 'FULL',
        })),
        todayKey,
        timezone: user?.timezone ?? null,
      });
      return {
        habitId: habit.id,
        title: habit.title,
        completionRate30: report.completionRates.d30.rate,
        missRate30: report.missRates.d30.rate,
        riskLevel: report.risk.level,
        riskScore: report.risk.score,
        momentumLevel: report.momentum.level,
        signals: [...report.signals],
        streakCurrent: report.streaks.current,
        streakLongest: report.streaks.longest,
        reducedKindShare: Number(
          (
            (report.kindMix30.minimum.share ?? 0) +
            (report.kindMix30.emergency.share ?? 0)
          ).toFixed(4),
        ),
        identityTitles: identityTitlesByHabit.get(habit.id) ?? [],
      };
    });

    const report = buildPortfolioOverloadReport(habits.length, summaries);
    return { ...report, insight: this.insight(report) };
  }

  /** Supportive, deterministic copy for the home card (never shaming). */
  private insight(report: PortfolioOverloadReport): {
    headline: string;
    message: string;
    ctaLabel: string;
  } {
    if (!report.overloaded) {
      return {
        headline: 'Your load looks manageable',
        message:
          'No systemic overload detected across your active habits right now.',
        ctaLabel: 'View habits',
      };
    }
    return {
      headline: 'You’re carrying a lot right now',
      message:
        `${report.highRiskHabitCount} of your ${report.analyzedHabitCount} ` +
        `analyzed habits are struggling, with an average miss rate of ` +
        `${Math.round((report.averageMissRate30 ?? 0) * 100)}%. ` +
        `Let’s reduce friction without losing your momentum.`,
      ctaLabel: 'Review habits',
    };
  }

  private async loadIdentityTitles(
    habitIds: string[],
  ): Promise<Map<string, string[]>> {
    if (habitIds.length === 0) return new Map();
    const links = await this.databaseSvc.identityHabit.findMany({
      where: { habitId: { in: habitIds } },
      select: { habitId: true, identity: { select: { title: true } } },
    });
    const map = new Map<string, string[]>();
    for (const link of links) {
      const list = map.get(link.habitId) ?? [];
      const title =
        typeof link.identity?.title === 'string' ? link.identity.title : '';
      if (title) list.push(title);
      map.set(link.habitId, list);
    }
    return map;
  }
}
