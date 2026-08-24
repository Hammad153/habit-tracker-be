/**
 * Phase 3.5 — deterministic adaptive-goal thresholds.
 *
 * Every number here is named, documented and unit-tested. Nothing in the
 * adaptive system may invent its own thresholds inline.
 */
export const ADAPTIVE_THRESHOLDS = {
  /** Minimum completions (any kind) in the last 30 days before proposing anything. */
  MIN_COMPLETION_SAMPLES_30D: 6,

  /** rate30 at/below this, combined with TOO_HARD, indicates an over-sized target. */
  REDUCE_TARGET_RATE30_MAX: 0.55,

  /** minimum-version share at/above this counts as "leaning on the minimum". */
  MINIMUM_SHARE_MIN: 0.45,

  /** full-version share at/below this means FULL is rarely the outcome. */
  FULL_SHARE_MAX: 0.35,

  /** emergency completions (count) in 30d at/above this = crisis crutch. */
  EMERGENCY_COUNT_30D_MIN: 4,

  /**
   * times_per_week schedules with quota at/above this AND a low 30d rate
   * may be proposed as less frequent.
   */
  REDUCE_FREQUENCY_TPW_MIN: 5,
  /** rate30 at/below this makes a frequent schedule suspect. */
  REDUCE_FREQUENCY_RATE30_MAX: 0.5,
  /** New weekly quota = max(NEW_TPW_FLOOR, floor(tpw * TPW_REDUCTION)). */
  NEW_TPW_FLOOR: 2,
  TPW_REDUCTION: 0.6,

  /** Proposals below this confidence are withheld entirely (§21). */
  CONFIDENCE_FLOOR: 0.6,

  /** Deterministic target reduction: halve the current goal, min step 1. */
  TARGET_REDUCTION_FACTOR: 0.5,

  /** Time-window evidence must beat the alternative by this ratio (reuses 3.2). */
  TIME_IMPROVEMENT_RATIO: 1.5,
} as const;

/**
 * Representative local wall-clock time for each Phase 3.1 time bucket.
 * Used ONLY when proposing CHANGE_TIME; deterministic by definition.
 */
export const BUCKET_SUGGESTED_TIME: Record<string, string> = {
  EARLY_MORNING: '06:30',
  MORNING: '09:30',
  AFTERNOON: '14:00',
  EVENING: '18:30',
  NIGHT: '21:30',
};

export const ADAPTIVE_STATES = [
  'NO_CHANGE',
  'TOO_HARD',
  'TIMING_PROBLEM',
  'CONSISTENCY_IMPROVING',
  'CONSISTENCY_DECLINING',
  'MINIMUM_VERSION_OVERUSED',
  'EMERGENCY_VERSION_OVERUSED',
  'INSUFFICIENT_EVIDENCE',
] as const;

export type AdaptiveState = (typeof ADAPTIVE_STATES)[number];

/** Smallest evidence-backed proposal subset (spec §6). */
export const ADAPTIVE_PROPOSAL_TYPES = [
  'REDUCE_TARGET',
  'REDUCE_FREQUENCY',
  'CHANGE_TIME',
] as const;

export type AdaptiveProposalType = (typeof ADAPTIVE_PROPOSAL_TYPES)[number];

// ---------------------------------------------------------------------------
// Phase 3.6 — adaptation outcome measurement (14-day window).
// ---------------------------------------------------------------------------

export const OUTCOME_RULES = {
  /** Observation length in calendar days starting at acceptance (Day 0). */
  EVALUATION_DAYS: 14,
  /** Minimum elapsed scheduled opportunities before classifying an outcome. */
  MIN_SCHEDULED_OPPORTUNITIES: 3,
  /** Completion-rate delta at/above which a side of the delta wins. */
  RATE_DELTA: 0.15,
} as const;

/** Risk band ordering used to translate risk movement into outcome signals. */
export const RISK_BAND_ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;

export type AdaptationOutcomeName =
  | 'PENDING'
  | 'INSUFFICIENT_DATA'
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'WORSENED';
