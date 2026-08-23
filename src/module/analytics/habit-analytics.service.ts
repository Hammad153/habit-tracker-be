import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import {
  BehaviorReport,
  CompletionFact,
  CompletionKindName,
  buildBehaviorReport,
} from '../../core/utils/behavior-analytics.utils';
import { BEHAVIOR_WINDOWS } from '../../core/utils/behavior.constants';
import { shiftDayKey } from '../../core/utils/schedule.utils';

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phase 3.1 — deterministic habit behavior analytics.
 *
 * This service is pure IO + delegation: every number it returns is computed
 * by the pure engine in core/utils/behavior-analytics.utils.ts using the
 * centralized configuration in behavior.constants.ts. No AI involvement.
 */
@Injectable()
export class HabitAnalyticsService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private static readonly COMPLETION_KINDS: CompletionKindName[] = [
    'FULL',
    'MINIMUM',
    'EMERGENCY',
  ];

  /** Validates an optional client-supplied analysis date (YYYY-MM-DD). */
  private resolveTodayKey(asOf?: string): string {
    if (asOf === undefined || asOf === null || asOf === '') {
      // Default follows the app-wide day-key convention; clients may always
      // pass their own local date explicitly via ?date=YYYY-MM-DD.
      return new Date().toISOString().slice(0, 10);
    }
    if (!DAY_KEY_PATTERN.test(asOf)) {
      throw new BadRequestException('date must be formatted as YYYY-MM-DD');
    }
    return asOf;
  }

  /** Loads the minimum data needed and delegates to the pure engine. */
  public async getHabitBehaviorReport(
    userId: string,
    habitId: string,
    asOf?: string,
  ): Promise<BehaviorReport> {
    const todayKey = this.resolveTodayKey(asOf);
    const windowStart = shiftDayKey(todayKey, -(BEHAVIOR_WINDOWS.LONG - 1));

    const habit = await this.databaseSvc.habit.findFirst({
      where: { id: habitId, userId },
      include: {
        completions: {
          where: { date: { gte: windowStart } },
          select: { date: true, status: true, value: true, kind: true, createdAt: true },
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!habit) throw new NotFoundException('Habit not found');

    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const facts: CompletionFact[] = habit.completions.map((c) => ({
      date: c.date,
      status: c.status,
      value: c.value,
      kind: HabitAnalyticsService.COMPLETION_KINDS.includes(
        c.kind as CompletionKindName,
      )
        ? (c.kind as CompletionKindName)
        : 'FULL',
      createdAt: c.createdAt,
    }));

    return buildBehaviorReport({
      habit: {
        id: habit.id,
        title: habit.title,
        goal: habit.goal,
        isArchived: habit.isArchived,
        scheduleType: habit.scheduleType,
        scheduleDays: habit.scheduleDays,
        timesPerWeek: habit.timesPerWeek,
        intervalDays: habit.intervalDays,
        startDate: habit.startDate,
        scheduledTime: habit.scheduledTime,
      },
      completions: facts,
      todayKey,
      timezone: user?.timezone ?? null,
    });
  }

  /** Compact risk view for UI badges and the future intervention engine. */
  public async getHabitRisk(userId: string, habitId: string, asOf?: string) {
    const report = await this.getHabitBehaviorReport(userId, habitId, asOf);
    return {
      habitId: report.habitId,
      habitTitle: report.habitTitle,
      analyzedAsOf: report.analyzedAsOf,
      risk: report.risk,
      momentum: report.momentum,
      signals: report.signals,
      structuredSignals: report.structuredSignals,
      insufficientHistory: report.insufficientHistory,
    };
  }
}
