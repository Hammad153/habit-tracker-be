import {
  InterventionActionType,
  InterventionCategory,
  InterventionConfidence,
  InterventionHabitContext,
  InterventionType,
} from './intervention.types';
import { BehaviorReport } from '../../core/utils/behavior-analytics.utils';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const INTERVENTION_THRESHOLDS = {
  /** A weak weekday only matters when it is at most this many days away. */
  WEEKDAY_APPROACH_WINDOW_DAYS: 2,

  /** best-window count must exceed worst-window count by this ratio. */
  TIME_IMPROVEMENT_RATIO: 1.5,

  /** Overload detection floors (cross-habit). Conservative by design. */
  OVERLOAD_MIN_ACTIVE_HABITS: 5,
  OVERLOAD_RISK_SHARE: 0.5,
  OVERLOAD_HABIT_MISS_RATE_FLOOR: 0.5,
  OVERLOAD_AVG_MISS_RATE_FLOOR: 0.4,

  /** Evidence-quality buckets based on 30-day completion sample size. */
  CONFIDENCE_HIGH_MIN_SAMPLES: 20,
  CONFIDENCE_MEDIUM_MIN_SAMPLES: 8,
} as const;

/** Evidence quality derived from sample size — deterministic, never AI. */
export const evidenceLevelFor = (sampleCount: number): InterventionConfidence => {
  if (sampleCount >= INTERVENTION_THRESHOLDS.CONFIDENCE_HIGH_MIN_SAMPLES) {
    return 'HIGH';
  }
  if (sampleCount >= INTERVENTION_THRESHOLDS.CONFIDENCE_MEDIUM_MIN_SAMPLES) {
    return 'MEDIUM';
  }
  return 'LOW';
};

/** Safety classification of actions (Phase 3.2 has no AUTO_SAFE mutations). */
export const ACTION_CATEGORY: Record<InterventionActionType, InterventionCategory> = {
  NONE: 'INFORMATIONAL',
  USE_MINIMUM_VERSION: 'USER_ACTION_REQUIRED',
  USE_EMERGENCY_VERSION: 'USER_ACTION_REQUIRED',
  OPEN_HABIT_EDIT: 'USER_ACTION_REQUIRED',
  CONFIGURE_HABIT_STACK: 'USER_ACTION_REQUIRED',
  REVIEW_ACTIVE_HABITS: 'USER_ACTION_REQUIRED',
};

// ---------------------------------------------------------------------------
// Configurable priority table
//
// Rules are evaluated top-to-bottom; the first match wins. Priorities exist
// for the client and the future AI coach — ordering is controlled here.
// ---------------------------------------------------------------------------

export interface RuleInput {
  report: BehaviorReport;
  ctx: InterventionHabitContext;
}

export interface InterventionDraft {
  type: InterventionType;
  title: string;
  reason: string;
  suggestedAction: InterventionActionType;
  sourceSignals: string[];
  facts: { [key: string]: string | number | boolean | null };
}

export interface InterventionRule {
  id: string;
  priority: number;
  evaluate: (input: RuleInput) => InterventionDraft | null;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Analytics signals carry full uppercase names ("THURSDAY"). */
const FULL_TO_KEY: Record<string, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat',
};

const KEY_TO_FULL: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};

/** Accepts "THURSDAY" or "Thu" and returns the short schedule key. */
export const weekdayKeyFromSignal = (raw: string): string =>
  FULL_TO_KEY[raw.toUpperCase()] ?? raw;

export const weekdayFullFromKey = (key: string): string =>
  KEY_TO_FULL[key] ?? key;

/** Days from `todayKey` until the given weekday key (0 = today). */
export const daysUntilWeekday = (todayKey: string, dayKey: string): number => {
  const todayIdx = new Date(`${todayKey}T12:00:00.000Z`).getUTCDay();
  const targetIdx = WEEKDAY_KEYS.indexOf(dayKey);
  if (targetIdx < 0) return Number.POSITIVE_INFINITY;
  return (targetIdx - todayIdx + 7) % 7;
};


/** Shared builder for weekday-preparedness drafts. */
const weekdayDraft = (
  report: RuleInput['report'],
  ctx: InterventionHabitContext,
  day: string,
  dayFull: string,
  completionRate: number,
): InterventionDraft | null => {
  const daysUntil = daysUntilWeekday(ctx.todayKey, weekdayKeyFromSignal(day));
  if (daysUntil > INTERVENTION_THRESHOLDS.WEEKDAY_APPROACH_WINDOW_DAYS) {
    return null;
  }
  if (ctx.stackCandidate && !ctx.hasExistingStack) {
    return {
      type: 'HABIT_STACK',
      title: `Anchor this habit before ${weekdayFullFromKey(weekdayKeyFromSignal(day))}`,
      reason:
        `${dayFull} is usually your hardest day for this habit ` +
        `(${pct(completionRate)} completion). ` +
        `You already have a reliable habit ("${ctx.stackCandidate.title}") — try placing this one immediately after it.`,
      suggestedAction: 'CONFIGURE_HABIT_STACK',
      sourceSignals: ['WEEKDAY_RISK'],
      facts: {
        weekday: weekdayKeyFromSignal(day),
        completionRate,
        stackCandidateRate: ctx.stackCandidate.rate30,
      },
    };
  }
  return {
    type: 'PREPARE_FOR_RISK',
    title: `${weekdayFullFromKey(weekdayKeyFromSignal(day))} is coming up`,
    reason:
      `${weekdayFullFromKey(weekdayKeyFromSignal(day))} is usually your hardest day for this habit ` +
      `(completed ${pct(completionRate)} of the time). ` +
      'Plan a smaller version for that day in advance.',
    suggestedAction:
      report.completedToday || ctx.minimumBehavior === null
        ? 'NONE'
        : 'USE_MINIMUM_VERSION',
    sourceSignals: ['WEEKDAY_RISK'],
    facts: {
        weekday: weekdayKeyFromSignal(day),
        completionRate,
        daysUntil,
      },
  };
};

export const INTERVENTION_RULES: InterventionRule[] = [
  // 1 — CRITICAL risk dominates everything.
  {
    id: 'CRITICAL_RISK_RECOVERY',
    priority: 100,
    evaluate: ({ report, ctx }) => {
      if (report.risk.level !== 'CRITICAL') return null;
      const action =
        report.completedToday || ctx.minimumBehavior === null
          ? 'NONE'
          : 'USE_MINIMUM_VERSION';
      return {
        type: 'RECOVERY',
        title: 'This habit needs a gentle restart',
        reason:
          `${report.risk.reasons[0] ?? 'The recent pattern shows heavy misses'}. ` +
          'Do not try to make up for everything at once — use the smallest version today and rebuild the rhythm.',
        suggestedAction: action as InterventionActionType,
        sourceSignals: ['AT_RISK', ...report.signals],
        facts: {
          riskScore: report.risk.score,
          missedLast7: report.missRates.d7.rate,
          rate7: report.completionRates.d7.rate,
        },
      };
    },
  },

  // 2 — HIGH risk + difficulty evidence beats other HIGH-risk angles.
  {
    id: 'HIGH_RISK_TOO_HARD',
    priority: 92,
    evaluate: ({ report, ctx }) => {
      if (
        report.risk.level !== 'HIGH' ||
        !report.signals.includes('TOO_HARD')
      ) {
        return null;
      }
      const difficulty = report.structuredSignals.find(
        (s) => s.type === 'DIFFICULTY_TOO_HIGH',
      );
      return {
        type: 'REDUCE_DIFFICULTY',
        title: 'This habit may be too difficult right now',
        reason:
          ctx.minimumBehavior
            ? `Your recent pattern suggests the full version may be too demanding. Use your minimum version (${ctx.minimumBehavior}) for a while.`
            : 'Your recent pattern suggests the current target may be too demanding. Consider lowering the goal so the minimum version stays reachable.',
        suggestedAction: ctx.minimumBehavior
          ? 'USE_MINIMUM_VERSION'
          : 'OPEN_HABIT_EDIT',
        sourceSignals: ['TOO_HARD', ...report.signals],
        facts: {
          difficultyConfidence: (difficulty?.confidence as number) ?? null,
          minimumShare30: report.kindMix30.minimum.share,
          emergencyShare30: report.kindMix30.emergency.share,
        },
      };
    },
  },

  // 3 — An approaching weak weekday: prepare or stack (HIGH risk ranks it
  // higher; a standalone preparedness rule below covers quieter bands).
  {
    id: 'HIGH_RISK_WEEKDAY',
    priority: 88,
    evaluate: ({ report, ctx }): InterventionDraft | null => {
      if (report.risk.level !== 'HIGH') return null;
      const found = report.structuredSignals.find(
        (s) => s.type === 'WEEKDAY_RISK',
      );
      if (!found) return null;
      const draft = weekdayDraft(
        report,
        ctx,
        String(found.day),
        String(found.dayFull),
        Number(found.completionRate),
      );
      if (!draft) return null;
      return { ...draft, sourceSignals: [...draft.sourceSignals, ...report.signals] };
    },
  },

  // 4 — HIGH risk + a clearly better time window.
  {
    id: 'HIGH_RISK_TIME_WINDOW',
    priority: 84,
    evaluate: ({ report, ctx }) => {
      if (report.risk.level !== 'HIGH') return null;
      const { best, worst, scheduledBucketCode } = report.timeWindows;
      if (!best || !worst || best.code === scheduledBucketCode) return null;
      if (best.count < worst.count * INTERVENTION_THRESHOLDS.TIME_IMPROVEMENT_RATIO) {
        return null;
      }
      return {
        type: 'CHANGE_TIME',
        title: 'A different time of day may work better',
        reason:
          `You complete this habit most consistently in the ${best.label.toLowerCase()} ` +
          `(${best.count} of your last completions), but it is scheduled for ${ctx.cueTime ?? 'an unspecified time'}. ` +
          'Consider moving it closer to that window — you decide.',
        suggestedAction: 'OPEN_HABIT_EDIT',
        sourceSignals: ['BEST_TIME_WINDOW', ...report.signals],
        facts: {
          bestWindow: best.code,
          bestCount: best.count,
          worstWindow: worst?.code ?? null,
        },
      };
    },
  },

  // 5 — Cross-habit overload (evidence pre-validated by the service).
  {
    id: 'CROSS_HABIT_OVERLOAD',
    priority: 82,
    evaluate: ({ report, ctx }) => {
      if (!ctx.crossHabit) return null;
      const { activeHabits, habitsAtRisk, avgMissRate30 } = ctx.crossHabit;
      if (activeHabits < INTERVENTION_THRESHOLDS.OVERLOAD_MIN_ACTIVE_HABITS) {
        return null;
      }
      if (habitsAtRisk / activeHabits < INTERVENTION_THRESHOLDS.OVERLOAD_RISK_SHARE) {
        return null;
      }
      if ((avgMissRate30 ?? 0) < INTERVENTION_THRESHOLDS.OVERLOAD_AVG_MISS_RATE_FLOOR) {
        return null;
      }
      return {
        type: 'PREPARE_FOR_RISK',
        title: 'Your habit load may be too heavy',
        reason:
          `${habitsAtRisk} of your ${activeHabits} active habits missed half or more ` +
          `of their scheduled days this month (average miss rate ${pct(avgMissRate30 ?? 0)}). ` +
          'Consider protecting your core habits before adding more.',
        suggestedAction: 'REVIEW_ACTIVE_HABITS',
        sourceSignals: ['OVERLOADED', ...report.signals],
        facts: { activeHabits, habitsAtRisk, avgMissRate30 },
      };
    },
  },

  // 6 — Declining trend: get the rhythm back with the smallest step.
  {
    id: 'DECLINING_RECOVERY',
    priority: 80,
    evaluate: ({ report, ctx }) => {
      if (!report.signals.includes('DECLINING')) return null;
      const action =
        report.completedToday || ctx.minimumBehavior === null
          ? 'NONE'
          : 'USE_MINIMUM_VERSION';
      return {
        type: 'RECOVERY',
        title: 'Your pace has dropped recently',
        reason:
          `Completion fell to ${pct(report.completionRates.d7.rate ?? 0)} this week ` +
          `against a ${pct(report.completionRates.d30.rate ?? 0)} monthly baseline. ` +
          'Restart small today — consistency first, volume later.',
        suggestedAction: action as InterventionActionType,
        sourceSignals: [...report.signals],
        facts: {
          rate7: report.completionRates.d7.rate,
          rate30: report.completionRates.d30.rate,
        },
      };
    },
  },

  // 7 — At-risk moderate band + actionable today: gentle nudge.
  {
    id: 'AT_RISK_TODAY',
    priority: 78,
    evaluate: ({ report, ctx }) => {
      if (!report.signals.includes('AT_RISK')) return null;
      if (report.risk.level === 'CRITICAL') {
        return null; // handled by CRITICAL_RISK_RECOVERY
      }
      if (report.completedToday || !ctx.scheduledToday) return null;
      return {
        type: 'RECOVERY',
        title: 'Today is a good day to show up small',
        reason:
          `You have missed several of your recent scheduled days ` +
          `(${pct(report.missRates.d7.rate ?? 0)} miss rate over the last week). ` +
          'Do not aim for a perfect session — use the minimum version and keep the chain alive.',
        suggestedAction: ctx.minimumBehavior ? 'USE_MINIMUM_VERSION' : 'NONE',
        sourceSignals: [...report.signals],
        facts: { missRate7: report.missRates.d7.rate ?? 0 },
      };
    },
  },

  // 8 — Recovery deserves recognition, not more pressure.
  {
    id: 'RECOVERING_PROTECT_MOMENTUM',
    priority: 76,
    evaluate: ({ report }) => {
      if (!report.signals.includes('RECOVERING')) return null;
      return {
        type: 'PROTECT_MOMENTUM',
        title: "You're getting your rhythm back",
        reason:
          `After a slower week (${pct(report.previousWeekRate ?? 0)}), you are back to ` +
          `${pct(report.completionRates.d7.rate ?? 0)} this week. Keep the current routine stable — protect the streak.`,
        suggestedAction: 'NONE',
        sourceSignals: [...report.signals],
        facts: {
          previousWeekRate: report.previousWeekRate,
          rate7: report.completionRates.d7.rate,
          currentStreak: report.streaks.current,
        },
      };
    },
  },

  // 8b — Weekday preparedness at lower urgency for calmer bands.
  {
    id: 'WEEKDAY_PREP',
    priority: 74,
    evaluate: ({ report, ctx }): InterventionDraft | null => {
      if (
        report.risk.level === 'HIGH' ||
        report.risk.level === 'CRITICAL'
      ) {
        return null; // handled by HIGH_RISK_WEEKDAY
      }
      const found = report.structuredSignals.find(
        (s) => s.type === 'WEEKDAY_RISK',
      );
      if (!found) return null;
      const draft = weekdayDraft(
        report,
        ctx,
        String(found.day),
        String(found.dayFull),
        Number(found.completionRate),
      );
      if (!draft) return null;
      return { ...draft, sourceSignals: [...draft.sourceSignals, ...report.signals] };
    },
  },

  // 9 — Strong momentum: reinforce identity, never manufacture problems.
  {
    id: 'STRONG_MOMENTUM_IDENTITY',
    priority: 70,
    evaluate: ({ report, ctx }) => {
      if (report.momentum.level !== 'STRONG') return null;
      if (report.risk.level === 'HIGH' || report.risk.level === 'CRITICAL') {
        return null;
      }
      const identityPart = ctx.identityTitle
        ? `You are becoming ${withIndefiniteArticle(ctx.identityTitle)}. `
        : '';
      return {
        type: 'REINFORCE_IDENTITY',
        title: 'Keep the streak alive',
        reason:
          identityPart +
          `You've completed this habit ${ctx.completionsLast30} time(s) in the last 30 days ` +
          `with a ${pct(report.completionRates.d30.rate ?? 0)} rate and a ${report.streaks.current}-day streak. Keep the routine stable.`,
        suggestedAction: 'NONE',
        sourceSignals: [...report.signals],
        facts: {
          identityTitle: ctx.identityTitle,
          completionsLast30: ctx.completionsLast30,
          rate30: report.completionRates.d30.rate,
          currentStreak: report.streaks.current,
        },
      };
    },
  },

  // 10 — Plain CONSISTENT without strong momentum → silence (product rule:
  // a good engine frequently recommends nothing).
  {
    id: 'CONSISTENT_NO_INTERVENTION',
    priority: 60,
    evaluate: () => null,
  },
];

const withIndefiniteArticle = (title: string): string => {
  const lowered = title.trim().toLowerCase();
  const vowelFirst = /^[aeiou]/.test(lowered);
  return `${vowelFirst ? 'an' : 'a'} ${title.trim()}`;
};
