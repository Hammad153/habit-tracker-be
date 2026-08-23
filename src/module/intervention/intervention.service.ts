import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../../core/database/database.service';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';
import {
  buildDaySeries,
  missRateForWindow,
  rateForWindow,
} from '../../core/utils/behavior-analytics.utils';
import { BEHAVIOR_WINDOWS, SIGNAL_THRESHOLDS } from '../../core/utils/behavior.constants';
import { AnalyzedHabit } from '../../core/utils/behavior-analytics.utils';
import { isScheduledOnDate, shiftDayKey } from '../../core/utils/schedule.utils';
import { evaluateIntervention } from './intervention.engine';
import { INTERVENTION_THRESHOLDS } from './intervention.constants';
import {
  CrossHabitInsight,
  Intervention,
  InterventionHabitContext,
} from './intervention.types';

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SIBLINGS = 50;

/** Minimal schedule facts needed by the pure analytics utils. */
interface ScheduleFacts {
  scheduleType: string | null;
  scheduleDays: string[];
  timesPerWeek: number | null;
  intervalDays: number | null;
  startDate: Date | null;
}

interface SiblingRow extends ScheduleFacts {
  id: string;
  title: string;
  completions: Array<{ date: string; status: boolean }>;
}

/**
 * Phase 3.2 — deterministic intervention recommendations.
 *
 * Read-only by contract: never mutates habits, rewards, or any other domain
 * state. The engine decides; the user acts.
 */
@Injectable()
export class InterventionService {
  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly habitAnalyticsSvc: HabitAnalyticsService,
  ) {}

  /** Validates an optional client-supplied analysis date (YYYY-MM-DD). */
  private static resolveTodayKey(asOf?: string): string {
    if (asOf === undefined || asOf === null || asOf === '') {
      return new Date().toISOString().slice(0, 10);
    }
    if (!DAY_KEY_PATTERN.test(asOf)) {
      throw new BadRequestException('date must be formatted as YYYY-MM-DD');
    }
    const parsed = new Date(`${asOf}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== asOf
    ) {
      throw new BadRequestException('date must be a valid calendar date');
    }
    return asOf;
  }

  /**
   * Deterministic intervention for one habit on one date.
   * Reuses the Phase 3.1 analytics service for the BehaviorReport (spec §37)
   * instead of reloading and recomputing completions independently.
   */
  public async getForHabit(
    userId: string,
    habitId: string,
    date?: string,
  ): Promise<{ intervention: Intervention | null }> {
    const todayKey = InterventionService.resolveTodayKey(date);

    const habit = await this.databaseSvc.habit.findFirst({
      where: { id: habitId, userId },
      select: {
        id: true,
        isArchived: true,
        scheduledTime: true,
        fullBehavior: true,
        minimumBehavior: true,
        emergencyMinimum: true,
        stackAfterHabitId: true,
        scheduleType: true,
        scheduleDays: true,
        timesPerWeek: true,
        intervalDays: true,
        startDate: true,
      },
    });
    if (!habit) throw new NotFoundException('Habit not found');

    const report = await this.habitAnalyticsSvc.getHabitBehaviorReport(
      userId,
      habitId,
      date,
    );

    const [siblings, identityLink] = await Promise.all([
      this.loadSiblings(userId, habitId, todayKey),
      this.databaseSvc.identityHabit.findFirst({
        where: { habitId },
        select: { identity: { select: { title: true } } },
      }),
    ]);

    const ctx: InterventionHabitContext = {
      habitId,
      todayKey,
      cueTime: habit.scheduledTime ?? null,
      fullBehavior: habit.fullBehavior ?? null,
      minimumBehavior: habit.minimumBehavior ?? null,
      emergencyMinimum: habit.emergencyMinimum ?? null,
      scheduledToday:
        !habit.isArchived &&
        isScheduledOnDate(
          {
            scheduleType: habit.scheduleType,
            scheduleDays: habit.scheduleDays,
            timesPerWeek: habit.timesPerWeek,
            intervalDays: habit.intervalDays,
            startDate: habit.startDate,
          },
          todayKey,
        ),
      hasExistingStack: !!habit.stackAfterHabitId,
      stackCandidate: this.pickStackCandidate(siblings, todayKey),
      identityTitle: identityLink?.identity?.title ?? null,
      completionsLast30: report.kindMix30.total,
      crossHabit: this.assessOverload(siblings, todayKey),
    };

    const evaluated = evaluateIntervention(report, ctx);
    if (!evaluated) return { intervention: null };

    return {
      intervention: {
        ...evaluated,
        fingerprint: InterventionService.fingerprint(
          userId,
          evaluated.type,
          evaluated.sourceSignals,
          todayKey,
        ),
      },
    };
  }

  /** Stable fingerprint so clients can suppress repeat display (spec §23). */
  private static fingerprint(
    userId: string,
    type: string,
    sourceSignals: string[],
    todayKey: string,
  ): string {
    // ISO-week start keeps the fingerprint stable across same-week refreshes.
    const dow = new Date(`${todayKey}T12:00:00.000Z`).getUTCDay();
    const weekStart = shiftDayKey(todayKey, -((dow + 6) % 7));
    return createHash('sha1')
      .update(
        [userId, type, weekStart, [...sourceSignals].sort().join('+')].join('|'),
      )
      .digest('hex')
      .slice(0, 16);
  }

  /** One bounded query; per-sibling rates come from the pure analytics utils. */
  private async loadSiblings(
    userId: string,
    excludeHabitId: string,
    todayKey: string,
  ): Promise<SiblingRow[]> {
    const windowStart = shiftDayKey(todayKey, -(BEHAVIOR_WINDOWS.MEDIUM - 1));
    const rows = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false, id: { not: excludeHabitId } },
      select: {
        id: true,
        title: true,
        scheduleType: true,
        scheduleDays: true,
        timesPerWeek: true,
        intervalDays: true,
        startDate: true,
        completions: {
          where: { date: { gte: windowStart }, status: true },
          select: { date: true, status: true },
        },
      },
      take: MAX_SIBLINGS,
    });
    return rows as SiblingRow[];
  }

  private static shapeOf(
    row: ScheduleFacts & { id?: string },
  ): AnalyzedHabit {
    return {
      id: row.id ?? 'sibling',
      scheduleType: row.scheduleType,
      scheduleDays: row.scheduleDays,
      timesPerWeek: row.timesPerWeek,
      intervalDays: row.intervalDays,
      startDate: row.startDate,
    };
  }

  /** Most reliable sibling habit — the preferred stacking anchor. */
  private pickStackCandidate(siblings: SiblingRow[], todayKey: string) {
    let best: { habitId: string; title: string; rate30: number } | null = null;
    for (const sib of siblings) {
      const shape = InterventionService.shapeOf(sib);
      const series = buildDaySeries(
        shape,
        todayKey,
        BEHAVIOR_WINDOWS.MEDIUM,
        sib.completions.map((c) => ({ ...c, value: 0, kind: 'FULL' as const })),
      );
      const m = rateForWindow(series, shape, BEHAVIOR_WINDOWS.MEDIUM);
      if (m.rate === null || m.rate < SIGNAL_THRESHOLDS.CONSISTENT_RATE) continue;
      if (!best || m.rate > best.rate30) {
        best = { habitId: sib.id, title: sib.title, rate30: m.rate };
      }
    }
    return best;
  }

  /** Conservative cross-habit overload assessment (spec §16). Null when thin. */
  private assessOverload(
    siblings: SiblingRow[],
    todayKey: string,
  ): CrossHabitInsight | null {
    const activeCount = siblings.length + 1; // include the analyzed habit
    if (activeCount < INTERVENTION_THRESHOLDS.OVERLOAD_MIN_ACTIVE_HABITS) {
      return null;
    }
    let atRisk = 0;
    let rated = 0;
    let sum = 0;
    for (const sib of siblings) {
      const shape = InterventionService.shapeOf(sib);
      const series = buildDaySeries(
        shape,
        todayKey,
        BEHAVIOR_WINDOWS.MEDIUM,
        sib.completions.map((c) => ({ ...c, value: 0, kind: 'FULL' as const })),
      );
      const miss = missRateForWindow(series, shape, BEHAVIOR_WINDOWS.MEDIUM);
      if (miss.rate === null) continue;
      rated += 1;
      sum += miss.rate;
      if (miss.rate >= INTERVENTION_THRESHOLDS.OVERLOAD_HABIT_MISS_RATE_FLOOR) {
        atRisk += 1;
      }
    }
    // Not enough cleanly-rated siblings → refuse to fake the signal (§16).
    if (
      rated <
      Math.ceil(activeCount * INTERVENTION_THRESHOLDS.OVERLOAD_RISK_SHARE)
    ) {
      return null;
    }
    return {
      activeHabits: activeCount,
      habitsAtRisk: atRisk,
      avgMissRate30: rated > 0 ? Number((sum / rated).toFixed(4)) : null,
    };
  }
}
