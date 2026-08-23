import type { BehaviorReport } from '../../core/utils/behavior-analytics.utils';
import type { WeekRange } from '../../core/utils/week.utils';
import { SIGNAL_THRESHOLDS } from '../../core/utils/behavior.constants';


export interface WeeklyHabitEntry {
  habitId: string;
  title: string;
  report: BehaviorReport;
}

export interface WeeklyIdentityFact {
  /** Identity title — user-created DATA downstream, never an instruction. */
  name: string;
  evidencePoints: number;
  levelTitle: string;
}

export type WeeklyTrend = 'IMPROVING' | 'STEADY' | 'DECLINING';

export interface WeeklyHabitFact {
  title: string;
  completionRate: number | null;
  previousWeekRate: number | null;
  currentStreak: number;
  momentum: string | null;
  signal: string;
  improved: boolean;
  missedCount: number;
}

export interface WeeklyReviewFacts {
  week: WeekRange;
  overall: {
    completionRate: number | null;
    previousWeekRate: number | null;
    trend: WeeklyTrend;
    completedCount: number;
    expectedCount: number;
  };
  habits: WeeklyHabitFact[];
  identity: WeeklyIdentityFact[];
  patterns: {
    bestDay: string | null;
    weakestDay: string | null;
  };
  insufficientHistory: boolean;
}

const SIGNAL_PRIORITY = [
  'CONSISTENT',
  'RECOVERING',
  'STRONG_MOMENTUM',
  'AT_RISK',
  'DECLINING',
  'TOO_HARD',
];

const primarySignalOf = (signals: string[]): string =>
  SIGNAL_PRIORITY.find((s) => signals.includes(s)) ?? signals[0] ?? '';

const mean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
};

/** Deterministic mode with Monday-first tie-breaking. */
const modeDay = (
  days: Array<string | null>,
  order: readonly string[],
): string | null => {
  const counts = new Map<string, number>();
  for (const d of days) {
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const day of order) {
    const count = counts.get(day) ?? 0;
    if (count > bestCount) {
      best = day;
      bestCount = count;
    }
  }
  return best;
};

const WEEKDAY_MON_FIRST = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const buildWeeklyReviewFacts = (
  week: WeekRange,
  entries: WeeklyHabitEntry[],
  identities: WeeklyIdentityFact[],
): WeeklyReviewFacts => {
  const habitFacts: WeeklyHabitFact[] = entries.map(({ title, report }) => ({
    title,
    completionRate: report.completionRates.d7.rate,
    previousWeekRate: report.previousWeekRate,
    currentStreak: report.streaks.current,
    momentum: report.momentum.level,
    signal: primarySignalOf(report.signals),
    improved:
      report.completionRates.d7.rate !== null &&
      report.previousWeekRate !== null &&
      report.completionRates.d7.rate - report.previousWeekRate > 0,
    missedCount: report.missRates.d7.expected - (report.completionRates.d7.completed ?? 0),
  }));

  // Overall rate weighted by each habit's expected days in the week window.
  const expectedSum = entries.reduce(
    (sum, e) => sum + e.report.completionRates.d7.expected,
    0,
  );
  const completedSum = entries.reduce(
    (sum, e) => sum + (e.report.completionRates.d7.completed ?? 0),
    0,
  );
  const completionRate =
    expectedSum > 0 ? Number((completedSum / expectedSum).toFixed(4)) : null;
  const previousWeekRate = mean(
    habitFacts
      .map((h) => h.previousWeekRate)
      .filter((v): v is number => v !== null),
  );

  const delta =
    completionRate !== null && previousWeekRate !== null
      ? completionRate - previousWeekRate
      : 0;
  const trend: WeeklyTrend =
    delta >= SIGNAL_THRESHOLDS.RECOVERY_JUMP
      ? 'IMPROVING'
      : delta <= -SIGNAL_THRESHOLDS.DECLINE_DELTA
        ? 'DECLINING'
        : 'STEADY';

  const insufficientHistory =
    entries.length === 0 ||
    entries.every((e) => e.report.insufficientHistory);

  return {
    week,
    overall: {
      completionRate,
      previousWeekRate,
      trend,
      completedCount: completedSum,
      expectedCount: expectedSum,
    },
    habits: habitFacts,
    identity: identities.slice(0, 3),
    patterns: {
      bestDay: modeDay(
        entries.map((e) => e.report.bestDayOfWeek),
        WEEKDAY_MON_FIRST,
      ),
      weakestDay: modeDay(
        entries.map((e) => e.report.worstDayOfWeek),
        WEEKDAY_MON_FIRST,
      ),
    },
    insufficientHistory,
  };
};
