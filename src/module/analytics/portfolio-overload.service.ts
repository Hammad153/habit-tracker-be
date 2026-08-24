import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER } from '../../core/ai/ai-provider.interface';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import { DatabaseService } from '../../core/database/database.service';
import { HabitAnalyticsService } from './habit-analytics.service';
import {
  HabitLoadSummary,
  PortfolioOverloadReport,
  buildPortfolioOverloadReport,
} from './portfolio-overload.engine';
import { localDateKeyInZone } from '../../core/utils/week.utils';

const MAX_ACTIVE_HABITS = 50;

/**
 * Phase 3.6 — portfolio overload intelligence.
 *
 * Reuses Phase 3.1 reports per habit (no duplicated analytics) and the pure
 * engine for the decision. Deliberately makes NO NVIDIA call: the report is
 * deterministic and the client copy is templated server-side (cost control).
 */
@Injectable()
export class PortfolioOverloadService {
  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly habitAnalyticsSvc: HabitAnalyticsService,
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

    const habits = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_ACTIVE_HABITS,
    });

    const identityTitlesByHabit =
      await this.loadIdentityTitles(habits.map((h) => h.id));

    const summaries: HabitLoadSummary[] = [];
    for (const habit of habits) {
      try {
        // Ownership enforced inside; windows align to the user's today.
        const r = await this.habitAnalyticsSvc.getHabitBehaviorReport(
          userId,
          habit.id,
          todayKey,
        );
        summaries.push({
          habitId: habit.id,
          title: habit.title,
          completionRate30: r.completionRates.d30.rate,
          missRate30: r.missRates.d30.rate,
          riskLevel: r.risk.level,
          riskScore: r.risk.score,
          momentumLevel: r.momentum.level,
          signals: [...r.signals],
          streakCurrent: r.streaks.current,
          streakLongest: r.streaks.longest,
          reducedKindShare: Number(
            (
              (r.kindMix30.minimum.share ?? 0) + (r.kindMix30.emergency.share ?? 0)
            ).toFixed(4),
          ),
          identityTitles: identityTitlesByHabit.get(habit.id) ?? [],
        });
      } catch {
        // Unreadable habit simply does not join the analyzed set.
      }
    }

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
      const title = typeof link.identity?.title === 'string' ? link.identity.title : '';
      if (title) list.push(title);
      map.set(link.habitId, list);
    }
    return map;
  }
}
