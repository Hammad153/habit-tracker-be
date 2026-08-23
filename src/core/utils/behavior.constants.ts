/**
 * Phase 3.1 — Adaptive Behavior Intelligence configuration.
 *
 * Every threshold, weight and window used by the deterministic behavior
 * engine lives here. No magic numbers are allowed in the analytics code;
 * this file IS the transparency contract for how risk and momentum are
 * computed. The AI layer (Phase 3.4+) consumes these results — it never
 * computes them.
 */

// ---------------------------------------------------------------------------
// Analysis windows (in days, ending at and including the analysis date)
// ---------------------------------------------------------------------------

export const BEHAVIOR_WINDOWS = {
  SHORT: 7,
  MEDIUM: 30,
  LONG: 90,
  /** Momentum compares the last 7 days against the 7 days before them. */
  MOMENTUM_PREVIOUS: 7,
} as const;

// ---------------------------------------------------------------------------
// Risk score — transparent weighted model (weights must sum to 1)
//
// Each factor is normalized to 0..1 before weighting. The score maps to
// LOW < RISK_MODERATE_BOUND, MODERATE < RISK_HIGH_BOUND,
// HIGH < RISK_CRITICAL_BOUND, CRITICAL at or above.
// ---------------------------------------------------------------------------

export interface RiskFactorWeights {
  /** Share of expected days missed in the last 7 days. */
  recentMissRate: number;
  /** How much the 30d completion rate exceeds the 7d rate (decline). */
  declineTrend: number;
  /** Severity of a detected weak-weekday pattern. */
  weekdayWeakness: number;
  /** Share of last-7d completions that were only the MINIMUM version. */
  minimumUsage: number;
  /** Share of last-7d completions that were EMERGENCY versions. */
  emergencyUsage: number;
  /** Share of expected days missed in the last 30 days. */
  baselineMissRate: number;
}

export const RISK_WEIGHTS: RiskFactorWeights = {
  recentMissRate: 0.3,
  declineTrend: 0.2,
  weekdayWeakness: 0.15,
  minimumUsage: 0.1,
  emergencyUsage: 0.15,
  baselineMissRate: 0.1,
};

/** Decline magnitude (rate30 − rate7) that maps to a full-weight factor. */
export const RISK_DECLINE_SATURATION = 0.4;

export const RISK_LEVEL_BOUNDS = {
  MODERATE: 0.3,
  HIGH: 0.6,
  CRITICAL: 0.8,
} as const;

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

// ---------------------------------------------------------------------------
// Behavioral signals — thresholds
// ---------------------------------------------------------------------------

export const SIGNAL_THRESHOLDS = {
  /** rate30 at/above this with a live streak counts as CONSISTENT. */
  CONSISTENT_RATE: 0.8,
  /** Minimum current streak (days) for CONSISTENT. */
  CONSISTENT_MIN_STREAK: 3,

  /** rate7 below rate30 by more than this triggers DECLINING. */
  DECLINE_DELTA: 0.15,

  /** Previous-7d rate at/below this can qualify for RECOVERING… */
  RECOVERY_FLOOR: 0.34,
  /** …when the recent week improved by more than this. */
  RECOVERY_JUMP: 0.15,

  /** missRate7 at/above this flags AT_RISK even without a HIGH risk score. */
  MISS_RATE_ALERT: 0.4,

  /** emergency share of 30d completions at/above this feeds OVERLOADED. */
  OVERLOAD_EMERGENCY_SHARE: 0.25,
  /** missRate30 at/above this co-required for OVERLOADED. */
  OVERLOAD_MISS_RATE: 0.3,

  /** momentum at/above this (with a strong recent rate) is STRONG_MOMENTUM. */
  STRONG_MOMENTUM_SCORE: 0.75,
  /** rate7 required alongside STRONG_MOMENTUM_SCORE. */
  STRONG_MOMENTUM_RATE: 0.85,
} as const;

// ---------------------------------------------------------------------------
// Weekday pattern detection
// ---------------------------------------------------------------------------

export const WEEKDAY_PATTERN = {
  /** Minimum expected occurrences for a weekday to be judged (sample size). */
  MIN_SCHEDULED_PER_DAY: 3,
  /** A weekday whose rate is below this is considered weak… */
  WEAK_RATE: 0.5,
  /** …and only if other weekdays average above this (contrast). */
  OTHER_DAYS_MIN_RATE: 0.65,
} as const;

// ---------------------------------------------------------------------------
// Difficulty detection (TOO_HARD)
//
// Additive evidence model: each contributing fact adds its weight to a
// 0..1 confidence; the signal fires at or above CONFIDENCE_TRIGGER.
// ---------------------------------------------------------------------------

export const DIFFICULTY_EVIDENCE_WEIGHTS = {
  /** ≥40% of the last 7 completions were MINIMUM versions. */
  MINIMUM_HEAVY_WEEK: 0.3,
  /** At least one EMERGENCY completion in the last 7 days. */
  EMERGENCY_THIS_WEEK: 0.2,
  /** ≥15% of 30d completions were EMERGENCY versions. */
  EMERGENCY_CHRONIC: 0.2,
  /** Meaningful decline between the 30d and 7d rates. */
  RATE_DECLINING: 0.2,
  /** FULL completions are no longer the majority outcome. */
  FULL_NO_LONGER_MAJOR: 0.1,
} as const;

export const DIFFICULTY_CONFIDENCE_TRIGGER = 0.5;

// Minimum share of last-7 completions that counts as "minimum heavy".
export const DIFFICULTY_MINIMUM_SHARE = 0.4;
// Chronic emergency share of 30d completions.
export const DIFFICULTY_EMERGENCY_CHRONIC_SHARE = 0.15;

// ---------------------------------------------------------------------------
// Momentum score — transparent weighted model (weights must sum to 1)
// ---------------------------------------------------------------------------

export interface MomentumFactorWeights {
  /** Completion rate over the last 7 days. */
  recentConsistency: number;
  /** Trend: recent 7d rate versus the previous 7d rate. */
  trend: number;
  /** Current streak relative to the habit's longest streak (capped window). */
  streakStability: number;
  /** Identity-evidence growth: recent points as a share of both weeks. */
  evidenceGrowth: number;
}

export const MOMENTUM_WEIGHTS: MomentumFactorWeights = {
  recentConsistency: 0.35,
  trend: 0.2,
  streakStability: 0.25,
  evidenceGrowth: 0.2,
};

/** Trend normalization: a ±0.4 rate swing maps to the full 0..1 range. */
export const MOMENTUM_TREND_SWING = 0.4;
/** Streak stability saturates once the current streak reaches this many days. */
export const MOMENTUM_STREAK_CAP = 21;

export const MOMENTUM_LEVEL_BOUNDS = {
  /** Below FADING bound the label is FADING. */
  FADING: 0.35,
  /** Below STRONG bound (at/above FADING) the label is STEADY. */
  STRONG: 0.7,
} as const;

export type MomentumLevel = 'FADING' | 'STEADY' | 'STRONG';

// ---------------------------------------------------------------------------
// Time-window analysis
// ---------------------------------------------------------------------------

export interface TimeWindowDefinition {
  code: string;
  label: string;
  /** Inclusive start hour (local to the user's timezone). */
  startHour: number;
  /** Exclusive end hour; wraps midnight for the NIGHT window. */
  endHour: number;
}

export const TIME_WINDOWS: TimeWindowDefinition[] = [
  { code: 'EARLY_MORNING', label: '05:00-09:00', startHour: 5, endHour: 9 },
  { code: 'MORNING', label: '09:00-12:00', startHour: 9, endHour: 12 },
  { code: 'AFTERNOON', label: '12:00-17:00', startHour: 12, endHour: 17 },
  { code: 'EVENING', label: '17:00-21:00', startHour: 17, endHour: 21 },
  { code: 'NIGHT', label: '21:00-05:00', startHour: 21, endHour: 5 },
];

/** Completions needed inside the window before best/worst are reported. */
export const TIME_WINDOW_MIN_SAMPLE = 5;

/** Fallback timezone when the user has none configured. */
export const DEFAULT_TIMEZONE = 'UTC';
