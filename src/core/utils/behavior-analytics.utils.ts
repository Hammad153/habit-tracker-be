/**
 * Phase 3.1 — Deterministic behavior analytics engine (pure functions).
 *
 * Everything here is explainable and testable without a database: inputs are
 * plain habit shapes, completion rows and day keys. The NestJS-level service
 * only loads data and delegates; the AI layer (Phase 3.4+) may interpret the
 * OUTPUT of this engine but must never recompute or override it.
 *
 * Timezone rule (Phase 0 audit): day arithmetic stays on YYYY-MM-DD keys and
 * never depends on server UTC. Time-of-day analysis converts timestamps to
 * the USER'S configured timezone and reports which timezone was used.
 */

import {
  BEHAVIOR_WINDOWS,
  DIFFICULTY_CONFIDENCE_TRIGGER,
  DIFFICULTY_EMERGENCY_CHRONIC_SHARE,
  DIFFICULTY_EVIDENCE_WEIGHTS,
  DIFFICULTY_MINIMUM_SHARE,
  MomentumLevel,
  MOMENTUM_LEVEL_BOUNDS,
  MOMENTUM_STREAK_CAP,
  MOMENTUM_TREND_SWING,
  MomentumFactorWeights,
  MOMENTUM_WEIGHTS,
  RISK_DECLINE_SATURATION,
  RiskFactorWeights,
  RiskLevel,
  RISK_LEVEL_BOUNDS,
  RISK_WEIGHTS,
  SIGNAL_THRESHOLDS,
  TimeWindowDefinition,
  TIME_WINDOW_MIN_SAMPLE,
  TIME_WINDOWS,
  WEEKDAY_PATTERN,
  DEFAULT_TIMEZONE,
} from './behavior.constants';
import { EVIDENCE_POINTS } from './evidence.utils';
import {
  HabitScheduleShape,
  isScheduledOnDate,
  shiftDayKey,
  weekdayKeyOf,
} from './schedule.utils';

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Display order Monday-first, matching product language. */
export const WEEKDAY_DISPLAY_ORDER: WeekdayKey[] = [
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
];

const WEEKDAY_FULL: Record<WeekdayKey, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
/** Quantize weighted sums so band boundaries (e.g. 0.30/0.60/0.80) are not
 *  defeated by floating-point dust like 0.7999999999999999. */
const quantize = (n: number): number => Number(n.toFixed(6));

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export type CompletionKindName = 'FULL' | 'MINIMUM' | 'EMERGENCY';

export interface CompletionFact {
  date: string; // YYYY-MM-DD
  status: boolean;
  value: number;
  kind: CompletionKindName;
  /** Optional completion timestamp (rows created after Phase 3 migration). */
  createdAt?: Date | string | null;
}

/** Minimal habit projection the engine needs. */
export interface AnalyzedHabit extends HabitScheduleShape {
  id: string;
  title?: string;
  goal?: number | null;
  isArchived?: boolean;
  /** Local wall-clock HH:mm the habit is planned for (if any). */
  scheduledTime?: string | null;
}

// ---------------------------------------------------------------------------
// Day series construction
// ---------------------------------------------------------------------------

export interface DayObservation {
  dateKey: string;
  scheduled: boolean;
  isToday: boolean;
  completion?: CompletionFact;
}

/**
 * Builds the observation window ending at (and including) `todayKey`.
 * Days before the habit's startDate are never "scheduled", so new habits are
 * never punished for days that predate them.
 */
export const buildDaySeries = (
  habit: AnalyzedHabit,
  todayKey: string,
  windowDays: number,
  completions: CompletionFact[],
): DayObservation[] => {
  const byDate = new Map<string, CompletionFact>();
  for (const c of completions) byDate.set(c.date, c);

  const startKey =
    habit.startDate instanceof Date
      ? habit.startDate.toISOString().slice(0, 10)
      : (habit.startDate?.slice(0, 10) ?? null);

  const series: DayObservation[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dateKey = shiftDayKey(todayKey, -i);
    const beforeStart = startKey !== null && dateKey < startKey;
    series.push({
      dateKey,
      scheduled: !beforeStart && isScheduledOnDate(habit, dateKey),
      isToday: dateKey === todayKey,
      completion: byDate.get(dateKey),
    });
  }
  return series;
};

// ---------------------------------------------------------------------------
// Expectation model (fair across schedule types)
// ---------------------------------------------------------------------------

/**
 * Expected number of successful days for an ELAPSED portion of the schedule.
 *
 * - daily / specific_days / interval: one per eligible elapsed day
 * - times_per_week: weekly quota pro-rated across the window, capped by the
 *   number of eligible days (a 3x/week habit is not penalized for resting
 *   days it never planned).
 */
export const expectedCompletions = (
  habit: AnalyzedHabit,
  eligiblePastDays: number,
  windowDays: number,
): number => {
  if (habit.scheduleType === 'times_per_week') {
    const quota = Math.max(1, habit.timesPerWeek ?? 1);
    const weeks = Math.max(1, windowDays) / 7;
    return Math.min(eligiblePastDays, Math.ceil(quota * weeks));
  }
  return eligiblePastDays;
};

// ---------------------------------------------------------------------------
// Core metric set
// ---------------------------------------------------------------------------

export interface RateMetric {
  /** null means "not enough history to judge" — different from 0%. */
  rate: number | null;
  expected: number;
  completed: number;
}

/** Missed = expected minus completed, floored at zero. */
export const missedCount = (m: RateMetric): number =>
  m.rate === null ? 0 : Math.max(0, m.expected - m.completed);

/**
 * Completion rate over the last `windowDays` of the series.
 *
 * Today is only counted once it has a completed outcome: an unfinished today
 * is "not yet a miss", while completing today demonstrates consistency
 * immediately.
 */
export const rateForWindow = (
  series: DayObservation[],
  habit: AnalyzedHabit,
  windowDays: number,
): RateMetric => {
  const slice = series.slice(-windowDays);
  let eligiblePast = 0;
  let completedPast = 0;

  for (const day of slice) {
    if (day.isToday || !day.scheduled) continue;
    eligiblePast += 1;
    if (day.completion?.status === true) completedPast += 1;
  }

  const today = series[series.length - 1];
  const completedToday =
    today !== undefined && today.isToday && today.completion?.status === true;

  const expected = expectedCompletions(habit, eligiblePast, windowDays);
  const finalExpected = expected + (completedToday ? 1 : 0);
  const finalCompleted = completedPast + (completedToday ? 1 : 0);

  if (finalExpected === 0) {
    return { rate: null, expected: 0, completed: 0 };
  }
  return {
    rate: Math.min(1, finalCompleted / finalExpected),
    expected: finalExpected,
    completed: finalCompleted,
  };
};

export const missRateForWindow = (
  series: DayObservation[],
  habit: AnalyzedHabit,
  windowDays: number,
): RateMetric => {
  const r = rateForWindow(series, habit, windowDays);
  return {
    rate: r.rate === null ? null : clamp01(1 - r.rate),
    expected: r.expected,
    completed: r.completed,
  };
};

/** Longest run of consecutive status=true days anywhere in history. */
export const longestStreakFromDates = (completedDatesAsc: string[]): number => {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of completedDatesAsc) {
    const consecutive = prev !== null && shiftDayKey(prev, 1) === key;
    run = consecutive ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
};

/**
 * Current streak counting back from `todayKey`. An uncompleted TODAY does not
 * break a streak that is alive through yesterday. Streak freezes live in a
 * separate table and are intentionally neutral here: they neither extend nor
 * break analytics streaks (the reward engine applies them where they matter).
 */
export const currentStreakFrom = (
  completedDatesAsc: string[],
  todayKey: string,
): number => {
  const done = new Set(completedDatesAsc);
  let cursor = todayKey;
  if (!done.has(cursor)) cursor = shiftDayKey(cursor, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
    if (streak > 3650) break; // hard bound: ~10 years
  }
  return streak;
};

export interface KindShare {
  count: number;
  share: number | null; // fraction of completions in the window
}

export interface KindMix {
  total: number;
  full: KindShare;
  minimum: KindShare;
  emergency: KindShare;
}

export const kindShares = (
  completions: CompletionFact[],
  windowStartKey: string,
): KindMix => {
  const inWindow = completions.filter(
    (c) => c.status === true && c.date >= windowStartKey,
  );
  const total = inWindow.length;
  const share = (kind: CompletionKindName): KindShare => {
    const count = inWindow.filter((c) => c.kind === kind).length;
    return { count, share: total === 0 ? null : count / total };
  };
  return {
    total,
    full: share('FULL'),
    minimum: share('MINIMUM'),
    emergency: share('EMERGENCY'),
  };
};

export const averageCompletionValue = (
  completions: CompletionFact[],
  windowStartKey: string,
): number | null => {
  const values = completions
    .filter((c) => c.status === true && c.date >= windowStartKey)
    .map((c) => c.value)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
};

// ---------------------------------------------------------------------------
// Day-of-week analysis
// ---------------------------------------------------------------------------

export interface WeekdayStat {
  day: WeekdayKey;
  dayFull: string;
  scheduled: number;
  completed: number;
  /** null when the sample is too small to judge this weekday. */
  rate: number | null;
}

export const weekdayStats = (series: DayObservation[]): WeekdayStat[] => {
  const buckets = new Map<WeekdayKey, { scheduled: number; completed: number }>();
  for (const key of WEEKDAY_KEYS) buckets.set(key, { scheduled: 0, completed: 0 });

  for (const day of series) {
    if (day.isToday || !day.scheduled) continue;
    const wd = weekdayKeyOf(day.dateKey) as WeekdayKey;
    const b = buckets.get(wd)!;
    b.scheduled += 1;
    if (day.completion?.status === true) b.completed += 1;
  }

  return WEEKDAY_DISPLAY_ORDER.map((day) => {
    const b = buckets.get(day)!;
    const enough = b.scheduled >= WEEKDAY_PATTERN.MIN_SCHEDULED_PER_DAY;
    return {
      day,
      dayFull: WEEKDAY_FULL[day],
      scheduled: b.scheduled,
      completed: b.completed,
      rate: enough ? b.completed / b.scheduled : null,
    };
  });
};

export interface WeekdayRiskSignal {
  type: 'WEEKDAY_RISK';
  day: WeekdayKey;
  dayFull: string;
  completionRate: number;
}

export interface WeekdayPatternResult {
  bestDay: WeekdayStat | null;
  worstDay: WeekdayStat | null;
  weekdayRisk: WeekdayRiskSignal | null;
}

export const detectWeekdayPatterns = (
  stats: WeekdayStat[],
): WeekdayPatternResult => {
  const judgeable = stats.filter((s) => s.rate !== null);
  if (judgeable.length === 0) {
    return { bestDay: null, worstDay: null, weekdayRisk: null };
  }

  // Ties resolve to the earlier weekday in display order (stats are ordered).
  let bestDay = judgeable[0];
  let worstDay = judgeable[0];
  for (const s of judgeable) {
    if (s.rate! > bestDay.rate!) bestDay = s;
    if (s.rate! < worstDay.rate!) worstDay = s;
  }

  let weekdayRisk: WeekdayRiskSignal | null = null;
  if (judgeable.length >= 2 && worstDay.rate! < WEEKDAY_PATTERN.WEAK_RATE) {
    const others = judgeable.filter((s) => s.day !== worstDay.day);
    const otherAvg =
      others.reduce((sum, s) => sum + s.rate!, 0) / Math.max(1, others.length);
    if (otherAvg >= WEEKDAY_PATTERN.OTHER_DAYS_MIN_RATE) {
      weekdayRisk = {
        type: 'WEEKDAY_RISK',
        day: worstDay.day,
        dayFull: worstDay.dayFull,
        completionRate: worstDay.rate!,
      };
    }
  }

  return { bestDay, worstDay, weekdayRisk };
};

// ---------------------------------------------------------------------------
// Time-window analysis (user-timezone aware)
// ---------------------------------------------------------------------------

export interface TimeBucketStat {
  code: string;
  label: string;
  count: number;
}

export interface TimeWindowAnalysis {
  timezoneUsed: string;
  sampleSize: number;
  stats: TimeBucketStat[];
  best: TimeBucketStat | null;
  worst: TimeBucketStat | null;
  scheduledBucketCode: string | null;
}

/** Local "HH:mm" for an instant in the given IANA timezone (UTC fallback). */
export const zonedHhmm = (
  instant: Date | string,
  timezone: string | null | undefined,
): { hhmm: string; timezoneUsed: string } => {
  const tz = timezone?.trim() || DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { hhmm: fmt.format(new Date(instant)), timezoneUsed: tz };
  } catch {
    // Invalid/unsupported timezone: fall back to UTC rather than crashing.
    return zonedHhmm(instant, DEFAULT_TIMEZONE);
  }
};

export const bucketCodeForHhmm = (hhmm: string): string => {
  const hour = parseInt(hhmm.slice(0, 2), 10);
  const found = TIME_WINDOWS.find((w: TimeWindowDefinition) => {
    if (w.startHour < w.endHour) {
      return hour >= w.startHour && hour < w.endHour;
    }
    // Wrapping window (NIGHT 21:00-05:00)
    return hour >= w.startHour || hour < w.endHour;
  });
  return found?.code ?? TIME_WINDOWS[0].code;
};

export const analyzeTimeWindows = (
  completions: CompletionFact[],
  windowStartKey: string,
  timezone: string | null | undefined,
  scheduledTimeHhmm?: string | null,
): TimeWindowAnalysis => {
  const stats: TimeBucketStat[] = TIME_WINDOWS.map(
    (w: TimeWindowDefinition) => ({ code: w.code, label: w.label, count: 0 }),
  );
  const indexByCode = new Map(stats.map((s) => [s.code, s]));

  let timezoneUsed = timezone?.trim() || DEFAULT_TIMEZONE;
  let sampleSize = 0;

  for (const c of completions) {
    if (!(c.status === true && c.date >= windowStartKey)) continue;
    if (!c.createdAt) continue;
    const { hhmm, timezoneUsed: used } = zonedHhmm(c.createdAt, timezone);
    timezoneUsed = used;
    const code = bucketCodeForHhmm(hhmm);
    indexByCode.get(code)!.count += 1;
    sampleSize += 1;
  }

  // Stable sort keeps chronological order for tie-breaking.
  const ranked = [...stats].sort((a, b) => b.count - a.count);
  const nonEmpty = ranked.filter((s) => s.count > 0);
  const enoughData = sampleSize >= TIME_WINDOW_MIN_SAMPLE && nonEmpty.length >= 2;

  return {
    timezoneUsed,
    sampleSize,
    stats,
    best: enoughData ? nonEmpty[0] : null,
    // Worst = least-used bucket among those actually used (ties resolve to
    // the later window thanks to the stable sort).
    worst: enoughData ? nonEmpty[nonEmpty.length - 1] : null,
    scheduledBucketCode: scheduledTimeHhmm
      ? bucketCodeForHhmm(scheduledTimeHhmm)
      : null,
  };
};

// ---------------------------------------------------------------------------
// Difficulty detection (TOO_HARD)
// ---------------------------------------------------------------------------

export type DifficultyVerdict = {
  signal: 'TOO_HARD';
  confidence: number;
  reasons: string[];
} | null;

export const detectDifficulty = (input: {
  minimumShare7: number | null;
  emergencyCount7: number;
  emergencyShare30: number | null;
  declineMagnitude: number; // rate30 − rate7, may be negative
  fullIsMajorityOutcome30: boolean;
}): DifficultyVerdict => {
  const reasons: string[] = [];
  let confidence = 0;

  if ((input.minimumShare7 ?? 0) >= DIFFICULTY_MINIMUM_SHARE) {
    confidence += DIFFICULTY_EVIDENCE_WEIGHTS.MINIMUM_HEAVY_WEEK;
    reasons.push(
      `minimum version used for ${Math.round((input.minimumShare7 ?? 0) * 100)}% of the last 7 completions`,
    );
  }
  if (input.emergencyCount7 >= 1) {
    confidence += DIFFICULTY_EVIDENCE_WEIGHTS.EMERGENCY_THIS_WEEK;
    reasons.push(`emergency version used ${input.emergencyCount7} time(s) this week`);
  }
  if ((input.emergencyShare30 ?? 0) >= DIFFICULTY_EMERGENCY_CHRONIC_SHARE) {
    confidence += DIFFICULTY_EVIDENCE_WEIGHTS.EMERGENCY_CHRONIC;
    reasons.push(
      `emergency version covers ${Math.round((input.emergencyShare30 ?? 0) * 100)}% of 30-day completions`,
    );
  }
  if (input.declineMagnitude > SIGNAL_THRESHOLDS.DECLINE_DELTA) {
    confidence += DIFFICULTY_EVIDENCE_WEIGHTS.RATE_DECLINING;
    reasons.push('full-completion rate is declining');
  }
  if (!input.fullIsMajorityOutcome30) {
    confidence += DIFFICULTY_EVIDENCE_WEIGHTS.FULL_NO_LONGER_MAJOR;
    reasons.push('FULL completions are no longer the usual outcome');
  }

  if (confidence < DIFFICULTY_CONFIDENCE_TRIGGER) return null;
  return { signal: 'TOO_HARD', confidence: clamp01(confidence), reasons };
};

// ---------------------------------------------------------------------------
// Risk score — transparent weighted model
// ---------------------------------------------------------------------------

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export const riskLevelForScore = (score: number): RiskLevel => {
  if (score >= RISK_LEVEL_BOUNDS.CRITICAL) return 'CRITICAL';
  if (score >= RISK_LEVEL_BOUNDS.HIGH) return 'HIGH';
  if (score >= RISK_LEVEL_BOUNDS.MODERATE) return 'MODERATE';
  return 'LOW';
};

export interface RiskFactorInput {
  missRate7: number | null;
  rate7: number | null;
  rate30: number | null;
  missRate30: number | null;
  missed7: number;
  expected7: number;
  missed30: number;
  expected30: number;
  minimumCount7: number;
  completionsCount7: number;
  emergencyCount7: number;
  weekdayRisk: { dayFull: string; completionRate: number } | null;
}

export const computeRiskScore = (factors: RiskFactorInput): RiskAssessment => {
  const reasons: string[] = [];
  const weighted: Array<[keyof RiskFactorWeights, number]> = [];

  // 1. Recent miss rate
  weighted.push(['recentMissRate', factors.missRate7 ?? 0]);
  if (factors.missed7 > 0) {
    reasons.push(
      `${factors.missed7} of ${factors.expected7} scheduled days missed in the last 7 days`,
    );
  }

  // 2. Decline trend
  const declineMagnitude = Math.max(0, (factors.rate30 ?? 0) - (factors.rate7 ?? 0));
  weighted.push(['declineTrend', clamp01(declineMagnitude / RISK_DECLINE_SATURATION)]);
  if (declineMagnitude > SIGNAL_THRESHOLDS.DECLINE_DELTA) {
    reasons.push(
      `completion rate fell to ${pct(factors.rate7 ?? 0)} against a ${pct(factors.rate30 ?? 0)} 30-day baseline`,
    );
  }

  // 3. Weekday weakness severity
  const weakness = factors.weekdayRisk
    ? clamp01(
        (WEEKDAY_PATTERN.WEAK_RATE - factors.weekdayRisk.completionRate) /
          WEEKDAY_PATTERN.WEAK_RATE,
      )
    : 0;
  weighted.push(['weekdayWeakness', weakness]);
  if (factors.weekdayRisk) {
    reasons.push(
      `${factors.weekdayRisk.dayFull} completion rate is ${pct(factors.weekdayRisk.completionRate)}`,
    );
  }

  // 4. Minimum-version usage
  const minimumShare7 =
    factors.completionsCount7 > 0
      ? factors.minimumCount7 / factors.completionsCount7
      : 0;
  weighted.push(['minimumUsage', minimumShare7]);
  if (factors.minimumCount7 > 0) {
    reasons.push(
      `minimum version used for ${factors.minimumCount7} of the last ${factors.completionsCount7} completions`,
    );
  }

  // 5. Emergency usage
  const emergencyShare7 =
    factors.completionsCount7 > 0
      ? factors.emergencyCount7 / factors.completionsCount7
      : 0;
  weighted.push(['emergencyUsage', emergencyShare7]);
  if (factors.emergencyCount7 > 0) {
    reasons.push(
      `emergency version used ${factors.emergencyCount7} time(s) in the last 7 days`,
    );
  }

  // 6. Baseline (30d) miss rate
  weighted.push(['baselineMissRate', factors.missRate30 ?? 0]);
  if (factors.missed30 > 0) {
    reasons.push(
      `${factors.missed30} of ${factors.expected30} scheduled days missed in the last 30 days`,
    );
  }

  const score = quantize(
    clamp01(
      weighted.reduce((sum, [key, value]) => sum + RISK_WEIGHTS[key] * value, 0),
    ),
  );

  return { score, level: riskLevelForScore(score), reasons };
};

// ---------------------------------------------------------------------------
// Momentum score
// ---------------------------------------------------------------------------

export interface MomentumAssessment {
  /** null when there is not enough history to judge momentum. */
  score: number | null;
  level: MomentumLevel | null;
}

export const evidencePointsForWindow = (
  completions: CompletionFact[],
  fromKeyInclusive: string,
  toKeyExclusive: string,
): number =>
  completions
    .filter(
      (c) => c.status === true && c.date >= fromKeyInclusive && c.date < toKeyExclusive,
    )
    .reduce((sum, c) => sum + (EVIDENCE_POINTS[c.kind] ?? 0), 0);

export interface MomentumFactorInput {
  rate7: number | null;
  ratePrev7: number | null;
  currentStreak: number;
  longestStreak: number;
  evidenceRecent7: number;
  evidencePrev7: number;
}

export const computeMomentum = (
  input: MomentumFactorInput,
): MomentumAssessment => {
  if (input.rate7 === null) return { score: null, level: null };

  const trend = clamp01(
    0.5 + (input.rate7 - (input.ratePrev7 ?? input.rate7)) / MOMENTUM_TREND_SWING,
  );

  // A brand-new habit (longest = 0) starts from a 7-day baseline so early
  // momentum is cautious rather than inflated.
  const stabilityDenominator = Math.max(
    7,
    Math.min(input.longestStreak || input.currentStreak, MOMENTUM_STREAK_CAP),
  );
  const streakStability = clamp01(input.currentStreak / stabilityDenominator);

  const evidenceTotal = input.evidenceRecent7 + input.evidencePrev7;
  const evidenceGrowth =
    evidenceTotal === 0 ? 0.5 : input.evidenceRecent7 / evidenceTotal;

  const components: Array<[keyof MomentumFactorWeights, number]> = [
    ['recentConsistency', input.rate7],
    ['trend', trend],
    ['streakStability', streakStability],
    ['evidenceGrowth', evidenceGrowth],
  ];

  const score = quantize(
    clamp01(
      components.reduce((sum, [key, value]) => sum + MOMENTUM_WEIGHTS[key] * value, 0),
    ),
  );

  const level: MomentumLevel =
    score >= MOMENTUM_LEVEL_BOUNDS.STRONG
      ? 'STRONG'
      : score >= MOMENTUM_LEVEL_BOUNDS.FADING
        ? 'STEADY'
        : 'FADING';

  return { score, level };
};

// ---------------------------------------------------------------------------
// Behavioral signals
// ---------------------------------------------------------------------------

export interface StructuredSignal {
  type:
    | 'WEEKDAY_RISK'
    | 'DIFFICULTY_TOO_HIGH'
    | 'BEST_TIME_WINDOW'
    | 'INSUFFICIENT_HISTORY';
  [key: string]: unknown;
}

export interface DeriveSignalsInput {
  rate7: number | null;
  rate30: number | null;
  ratePrev7: number | null;
  missRate7: number | null;
  missRate30: number | null;
  emergencyShare30: number | null;
  currentStreak: number;
  riskLevel: RiskLevel;
  momentum: MomentumAssessment;
  weekdayRisk: WeekdayRiskSignal | null;
  difficulty: DifficultyVerdict;
  bestTimeWindow: TimeBucketStat | null;
  hasAnyCompletion: boolean;
}

export const deriveSignals = (
  input: DeriveSignalsInput,
): { signals: string[]; structuredSignals: StructuredSignal[] } => {
  const signals: string[] = [];
  const structured: StructuredSignal[] = [];

  if (!input.hasAnyCompletion) {
    structured.push({ type: 'INSUFFICIENT_HISTORY' });
    return { signals, structuredSignals: structured };
  }

  if (
    (input.rate30 ?? 0) >= SIGNAL_THRESHOLDS.CONSISTENT_RATE &&
    input.currentStreak >= SIGNAL_THRESHOLDS.CONSISTENT_MIN_STREAK
  ) {
    signals.push('CONSISTENT');
  }

  if (
    input.rate30 !== null &&
    input.rate7 !== null &&
    input.rate30 - input.rate7 > SIGNAL_THRESHOLDS.DECLINE_DELTA
  ) {
    signals.push('DECLINING');
  }

  if (
    input.ratePrev7 !== null &&
    input.ratePrev7 <= SIGNAL_THRESHOLDS.RECOVERY_FLOOR &&
    input.rate7 !== null &&
    input.rate7 - input.ratePrev7 > SIGNAL_THRESHOLDS.RECOVERY_JUMP
  ) {
    signals.push('RECOVERING');
  }

  if (
    (input.missRate7 ?? 0) >= SIGNAL_THRESHOLDS.MISS_RATE_ALERT ||
    input.riskLevel === 'HIGH' ||
    input.riskLevel === 'CRITICAL'
  ) {
    signals.push('AT_RISK');
  }

  if (
    (input.emergencyShare30 ?? 0) >=
      SIGNAL_THRESHOLDS.OVERLOAD_EMERGENCY_SHARE &&
    (input.missRate30 ?? 0) >= SIGNAL_THRESHOLDS.OVERLOAD_MISS_RATE
  ) {
    signals.push('OVERLOADED');
  }

  if (input.difficulty) {
    signals.push('TOO_HARD');
    structured.push({
      type: 'DIFFICULTY_TOO_HIGH',
      signal: input.difficulty.signal,
      confidence: Number(input.difficulty.confidence.toFixed(2)),
    });
  }

  if (
    input.momentum.score !== null &&
    input.momentum.score >= SIGNAL_THRESHOLDS.STRONG_MOMENTUM_SCORE &&
    (input.rate7 ?? 0) >= SIGNAL_THRESHOLDS.STRONG_MOMENTUM_RATE
  ) {
    signals.push('STRONG_MOMENTUM');
  }

  if (input.weekdayRisk) {
    structured.push({
      type: 'WEEKDAY_RISK',
      day: input.weekdayRisk.dayFull.toUpperCase(),
      completionRate: Number(input.weekdayRisk.completionRate.toFixed(2)),
    });
  }

  if (input.bestTimeWindow) {
    structured.push({
      type: 'BEST_TIME_WINDOW',
      code: input.bestTimeWindow.code,
      label: input.bestTimeWindow.label,
    });
  }

  return { signals, structuredSignals: structured };
};

// ---------------------------------------------------------------------------
// Full report assembly (pure — no IO)
// ---------------------------------------------------------------------------

export interface BehaviorReportInput {
  habit: AnalyzedHabit;
  completions: CompletionFact[];
  todayKey: string;
  timezone?: string | null;
}

export interface BehaviorReport {
  habitId: string;
  habitTitle: string;
  isArchived: boolean;
  analyzedAsOf: string;
  windows: { short: number; medium: number; long: number };
  completionRates: { d7: RateMetric; d30: RateMetric; d90: RateMetric };
  missRates: { d7: RateMetric; d30: RateMetric };
  streaks: { current: number; longest: number };
  kindMix30: KindMix;
  minimumCompletionRate30: number | null;
  emergencyCompletionRate30: number | null;
  averageCompletionValue30: number | null;
  previousWeekRate: number | null;
  weekday: WeekdayStat[];
  bestDayOfWeek: string | null;
  worstDayOfWeek: string | null;
  timeWindows: TimeWindowAnalysis;
  /** Timezone actually used for time-of-day bucketing (user tz or UTC fallback). */
  timezoneUsed: string;
  momentum: MomentumAssessment;
  risk: RiskAssessment;
  signals: string[];
  structuredSignals: StructuredSignal[];
  insufficientHistory: boolean;
}

export const buildBehaviorReport = (input: BehaviorReportInput): BehaviorReport => {
  const { habit, completions, todayKey } = input;
  const W = BEHAVIOR_WINDOWS;

  const series90 = buildDaySeries(habit, todayKey, W.LONG, completions);

  const d7 = rateForWindow(series90, habit, W.SHORT);
  const d30 = rateForWindow(series90, habit, W.MEDIUM);
  const d90 = rateForWindow(series90, habit, W.LONG);
  const miss7 = missRateForWindow(series90, habit, W.SHORT);
  const miss30 = missRateForWindow(series90, habit, W.MEDIUM);

  // Previous-week rate: days 8..14 before today (its own 7-day window).
  const prevWeekSlice = series90.slice(-(W.SHORT * 2), -W.SHORT);
  const prevWeekRate = rateForWindow(prevWeekSlice, habit, W.SHORT).rate;

  const completedDatesAsc = completions
    .filter((c) => c.status === true)
    .map((c) => c.date)
    .sort();
  const longest = longestStreakFromDates(completedDatesAsc);
  const currentStreak = currentStreakFrom(completedDatesAsc, todayKey);

  const mediumStart = shiftDayKey(todayKey, -(W.MEDIUM - 1));
  const shortStart = shiftDayKey(todayKey, -(W.SHORT - 1));

  const kindMix30 = kindShares(completions, mediumStart);
  const completionsLast7 = completions.filter(
    (c) => c.status === true && c.date >= shortStart,
  );

  const wdStats = weekdayStats(series90);
  const patterns = detectWeekdayPatterns(wdStats);

  const avgValue = averageCompletionValue(completions, mediumStart);

  const timeWindows = analyzeTimeWindows(
    completions,
    mediumStart,
    input.timezone,
    habit.scheduledTime,
  );

  const hasAnyCompletion = completions.some((c) => c.status === true);

  const difficulty = detectDifficulty({
    minimumShare7:
      completionsLast7.length > 0
        ? completionsLast7.filter((c) => c.kind === 'MINIMUM').length /
          completionsLast7.length
        : null,
    emergencyCount7: completionsLast7.filter((c) => c.kind === 'EMERGENCY').length,
    emergencyShare30: kindMix30.emergency.share,
    declineMagnitude: (d30.rate ?? 0) - (d7.rate ?? 0),
    fullIsMajorityOutcome30:
      kindMix30.total === 0 || kindMix30.full.share === null
        ? true
        : kindMix30.full.share > 0.5,
  });

  const risk = computeRiskScore({
    missRate7: miss7.rate,
    rate7: d7.rate,
    rate30: d30.rate,
    missRate30: miss30.rate,
    missed7: missedCount(miss7),
    expected7: d7.expected,
    missed30: missedCount(miss30),
    expected30: d30.expected,
    minimumCount7: completionsLast7.filter((c) => c.kind === 'MINIMUM').length,
    completionsCount7: completionsLast7.length,
    emergencyCount7: completionsLast7.filter((c) => c.kind === 'EMERGENCY').length,
    weekdayRisk: patterns.weekdayRisk,
  });

  const momentum = computeMomentum({
    rate7: d7.rate,
    ratePrev7: prevWeekRate,
    currentStreak,
    longestStreak: longest,
    evidenceRecent7: evidencePointsForWindow(completions, shortStart, shiftDayKey(todayKey, 1)),
    evidencePrev7: evidencePointsForWindow(
      completions,
      shiftDayKey(todayKey, -(W.SHORT * 2 - 1)),
      shortStart,
    ),
  });

  const { signals, structuredSignals } = deriveSignals({
    rate7: d7.rate,
    rate30: d30.rate,
    ratePrev7: prevWeekRate,
    missRate7: miss7.rate,
    missRate30: miss30.rate,
    emergencyShare30: kindMix30.emergency.share,
    currentStreak,
    riskLevel: risk.level,
    momentum,
    weekdayRisk: patterns.weekdayRisk,
    difficulty,
    bestTimeWindow: timeWindows.best,
    hasAnyCompletion,
  });

  return {
    habitId: habit.id,
    habitTitle: habit.title ?? habit.id,
    isArchived: habit.isArchived === true,
    analyzedAsOf: todayKey,
    windows: { short: W.SHORT, medium: W.MEDIUM, long: W.LONG },
    completionRates: { d7, d30, d90 },
    missRates: { d7: miss7, d30: miss30 },
    streaks: { current: currentStreak, longest },
    kindMix30,
    minimumCompletionRate30: kindMix30.minimum.share,
    emergencyCompletionRate30: kindMix30.emergency.share,
    averageCompletionValue30: avgValue,
    previousWeekRate: prevWeekRate,
    weekday: wdStats,
    bestDayOfWeek: patterns.bestDay?.dayFull ?? null,
    worstDayOfWeek: patterns.worstDay?.dayFull ?? null,
    timeWindows,
    timezoneUsed: timeWindows.timezoneUsed,
    momentum,
    risk,
    signals,
    structuredSignals,
    insufficientHistory: !hasAnyCompletion,
  };
};
