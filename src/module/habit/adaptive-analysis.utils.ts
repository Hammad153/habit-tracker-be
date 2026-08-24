import type { BehaviorReport } from '../../core/utils/behavior-analytics.utils';
import {
  ADAPTIVE_THRESHOLDS,
  AdaptiveProposalType,
  AdaptiveState,
  BUCKET_SUGGESTED_TIME,
} from '../../core/utils/adaptive.constants';

/**
 * Phase 3.5 — deterministic adaptive analysis.
 *
 * Answers "is there enough evidence to suggest this habit should change?"
 * purely from Phase 3.1 analytics. NO AI, NO randomness: identical inputs
 * always yield an identical proposal (or none).
 */

export interface AdaptiveHabitShape {
  goal: number;
  unit: string | null;
  scheduleType: string | null;
  timesPerWeek: number | null;
  scheduledTime: string | null;
}

export interface AdaptiveCurrentSnapshot {
  fullBehavior: string | null;
  minimumBehavior: string | null;
  emergencyMinimum: string | null;
  goal: number;
  unit: string | null;
  timesPerWeek: number | null;
  scheduledTime: string | null;
}

export interface AdaptiveProposedSnapshot {
  goal?: number;
  timesPerWeek?: number;
  scheduledTime?: string;
}

export interface AdaptiveEvidence {
  completionRate30: number | null;
  completionRate7: number | null;
  previousWeekRate: number | null;
  minimumShare30: number | null;
  fullShare30: number | null;
  emergencyCount30: number;
  currentStreak: number;
}

export interface AdaptiveAnalysis {
  state: AdaptiveState;
  confidence: number;
  evidence: AdaptiveEvidence;
  sourceSignals: string[];
  /** Concrete, applicable-through-the-edit-path change (null = advice only). */
  proposal: {
    type: AdaptiveProposalType;
    current: AdaptiveProposedSnapshot;
    proposed: AdaptiveProposedSnapshot;
  } | null;
  reason: string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const round2 = (v: number): number => Number(v.toFixed(2));

export const analyzeAdaptation = (
  report: BehaviorReport,
  shape: AdaptiveHabitShape,
  snapshots: {
    fullBehavior: string | null;
    minimumBehavior: string | null;
    emergencyMinimum: string | null;
  },
): AdaptiveAnalysis => {
  const evidence: AdaptiveEvidence = {
    completionRate30: report.completionRates.d30.rate,
    completionRate7: report.completionRates.d7.rate,
    previousWeekRate: report.previousWeekRate,
    minimumShare30: report.kindMix30.minimum.share,
    fullShare30: report.kindMix30.full.share,
    emergencyCount30: report.kindMix30.emergency.count,
    currentStreak: report.streaks.current,
  };
  const signals = [...report.signals];

  const base = {
    state: 'NO_CHANGE' as AdaptiveState,
    confidence: 0,
    evidence,
    sourceSignals: signals,
    proposal: null,
    reason: '',
  };

  // Gate 1 — tiny samples can never justify redesigning a habit.
  if (report.insufficientHistory || report.kindMix30.total < ADAPTIVE_THRESHOLDS.MIN_COMPLETION_SAMPLES_30D) {
    return { ...base, state: 'INSUFFICIENT_EVIDENCE', confidence: 0 };
  }

  // Gate 2 — thriving habits must not be "optimized".
  const rate30 = report.completionRates.d30.rate ?? 0;
  const thriving =
    rate30 >= 0.8 &&
    (report.momentum.level === 'STRONG' || report.signals.includes('CONSISTENT'));
  if (thriving) {
    return {
      ...base,
      state:
        report.previousWeekRate !== null &&
        (report.completionRates.d7.rate ?? 0) - report.previousWeekRate >= 0.15
          ? 'CONSISTENCY_IMPROVING'
          : 'NO_CHANGE',
      confidence: round2(Math.min(1, rate30)),
    };
  }

  // ---- Difficulty cluster -------------------------------------------------
  const tooHard = report.signals.includes('TOO_HARD');
  const minShare = report.kindMix30.minimum.share ?? 0;
  const fullShare = report.kindMix30.full.share ?? 0;
  const emergencyCount = report.kindMix30.emergency.count;

  const reduceTargetEligible =
    tooHard &&
    rate30 <= ADAPTIVE_THRESHOLDS.REDUCE_TARGET_RATE30_MAX &&
    shape.goal > 1;

  const minOveruse =
    minShare >= ADAPTIVE_THRESHOLDS.MINIMUM_SHARE_MIN &&
    fullShare <= ADAPTIVE_THRESHOLDS.FULL_SHARE_MAX;

  const emergencyCrutch =
    emergencyCount >= ADAPTIVE_THRESHOLDS.EMERGENCY_COUNT_30D_MIN && rate30 <= 0.6;

  if (reduceTargetEligible) {
    // Deterministic halving with a minimum step of one whole unit.
    const proposedGoal = Math.max(
      1,
      Math.floor(shape.goal * ADAPTIVE_THRESHOLDS.TARGET_REDUCTION_FACTOR),
    );
    let confidence = 0.4; // base when TOO_HARD + low rate both present
    confidence += rate30 <= 0.35 ? 0.25 : 0.15; // severity of the shortfall
    if (minOveruse) confidence += 0.2;
    if (emergencyCrutch) confidence += 0.1;
    if (report.signals.includes('DECLINING')) confidence += 0.05;
    confidence = round2(Math.min(1, confidence));

    const state: AdaptiveState = minOveruse
      ? 'MINIMUM_VERSION_OVERUSED'
      : 'TOO_HARD';

    return {
      ...base,
      state,
      confidence,
      proposal: {
        type: 'REDUCE_TARGET',
        current: { goal: shape.goal },
        proposed: { goal: proposedGoal },
      },
      reason:
        `Your ${shape.unit ? `${shape.unit} target` : 'target'} has been completed at ` +
        `${pct(rate30)} over the last 30 days` +
        (minOveruse
          ? `, with the minimum version carrying ${pct(minShare)} of completions.`
          : '. A smaller target is easier to repeat.'),
    };
  }

  // ---- Frequency cluster (quota-based schedules only) ---------------------
  if (
    shape.scheduleType === 'times_per_week' &&
    (shape.timesPerWeek ?? 0) >= ADAPTIVE_THRESHOLDS.REDUCE_FREQUENCY_TPW_MIN &&
    rate30 <= ADAPTIVE_THRESHOLDS.REDUCE_FREQUENCY_RATE30_MAX
  ) {
    const newTpw = Math.max(
      ADAPTIVE_THRESHOLDS.NEW_TPW_FLOOR,
      Math.floor((shape.timesPerWeek ?? 0) * ADAPTIVE_THRESHOLDS.TPW_REDUCTION),
    );
    const confidence = round2(
      Math.min(
        1,
        0.45 +
          ((shape.timesPerWeek ?? 0) - newTpw) / Math.max(1, shape.timesPerWeek ?? 1) * 0.3 +
          (tooHard ? 0.15 : 0),
      ),
    );
    return {
      ...base,
      state: 'TOO_HARD',
      confidence,
      proposal: {
        type: 'REDUCE_FREQUENCY',
        current: { timesPerWeek: shape.timesPerWeek ?? 0 },
        proposed: { timesPerWeek: newTpw },
      },
      reason:
        `You aimed for ${shape.timesPerWeek}×/week but completed ${pct(rate30)} of the ` +
        `expected sessions in the last 30 days. A lighter quota is easier to honor.`,
    };
  }

  // ---- Timing cluster ------------------------------------------------------
  const { best, worst, scheduledBucketCode } = report.timeWindows;
  if (
    best &&
    worst &&
    scheduledBucketCode &&
    best.code !== scheduledBucketCode &&
    best.count >= worst.count * ADAPTIVE_THRESHOLDS.TIME_IMPROVEMENT_RATIO
  ) {
    const suggested = BUCKET_SUGGESTED_TIME[best.code];
    if (suggested && shape.scheduledTime) {
      return {
        ...base,
        state: 'TIMING_PROBLEM',
        confidence: round2(Math.min(1, 0.5 + Math.min(0.3, best.count / 20))),
        proposal: {
          type: 'CHANGE_TIME',
          current: { scheduledTime: shape.scheduledTime },
          proposed: { scheduledTime: suggested },
        },
        reason:
          `You complete this most consistently in the ${best.label.toLowerCase()} ` +
          `(${best.count} recent completions), but it is scheduled for ${shape.scheduledTime}.`,
      };
    }
  }

  // ---- Advice-only states (no concrete deterministic change available) ----
  if (emergencyCrutch) {
    return {
      ...base,
      state: 'EMERGENCY_VERSION_OVERUSED',
      confidence: 0.5,
      reason:
        `The emergency version carried ${emergencyCount} of your last 30 days. ` +
        'Consider whether the everyday target fits ordinary days.',
    };
  }
  if (minOveruse) {
    return {
      ...base,
      state: 'MINIMUM_VERSION_OVERUSED',
      confidence: 0.5,
      reason:
        `Minimum versions carried ${pct(minShare)} of your completions while the ` +
        `full version was the outcome only ${pct(fullShare)} of the time.`,
    };
  }
  if (
    report.previousWeekRate !== null &&
    (report.completionRates.d7.rate ?? 0) - report.previousWeekRate <= -0.15
  ) {
    return {
      ...base,
      state: 'CONSISTENCY_DECLINING',
      confidence: 0.5,
      reason: 'This week came in below the previous one by 15 points or more.',
    };
  }

  return { ...base, state: 'NO_CHANGE', confidence: round2(Math.min(1, rate30)) };
};

/** Stable fingerprint so identical evidence reuses the open proposal. */
export const adaptiveFingerprint = (
  habitId: string,
  analysis: AdaptiveAnalysis,
): string => {
  if (!analysis.proposal) return '';
  const core = [
    habitId,
    analysis.proposal.type,
    JSON.stringify(analysis.proposal.current),
    JSON.stringify(analysis.proposal.proposed),
    // Evidence rounded coarsely: minor noise should not spawn new proposals.
    `r30:${Math.round((analysis.evidence.completionRate30 ?? 0) * 20)}`, // 5% buckets
    `min:${Math.round((analysis.evidence.minimumShare30 ?? 0) * 10)}`,
    analysis.state,
  ].join('|');
  // FNV-1a — small, dependency-free, deterministic.
  let hash = 0x811c9dc5;
  for (let i = 0; i < core.length; i++) {
    hash ^= core.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
