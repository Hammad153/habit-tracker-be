/**
 * Phase 3.2 — Adaptive Intervention Engine domain types.
 *
 * The engine is fully deterministic: given the same BehaviorReport, habit
 * context and date it always returns the same intervention (or none).
 * No AI, no randomness, no external calls.
 */

export type InterventionType =
  | 'RECOVERY'
  | 'REDUCE_DIFFICULTY'
  | 'USE_MINIMUM_VERSION'
  | 'USE_EMERGENCY_VERSION'
  | 'HABIT_STACK'
  | 'CHANGE_TIME'
  | 'CHANGE_CUE'
  | 'REINFORCE_IDENTITY'
  | 'PROTECT_MOMENTUM'
  | 'PREPARE_FOR_RISK'
  /** Represented as `null` in responses; kept for exhaustive client handling. */
  | 'NO_INTERVENTION';

export type InterventionActionType =
  | 'USE_MINIMUM_VERSION'
  | 'USE_EMERGENCY_VERSION'
  | 'OPEN_HABIT_EDIT'
  | 'CONFIGURE_HABIT_STACK'
  | 'REVIEW_ACTIVE_HABITS'
  | 'NONE';

export type InterventionCategory =
  | 'INFORMATIONAL'
  | 'USER_ACTION_REQUIRED';

/** Deterministic evidence quality — NOT an AI confidence score. */
export type InterventionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface InterventionSuggestedAction {
  type: InterventionActionType;
}

/** Structured facts for the future AI coach — it must never recompute these. */
export interface InterventionFacts {
  [key: string]: string | number | boolean | null;
}

export interface Intervention {
  type: InterventionType;
  priority: number;
  category: InterventionCategory;
  confidence: InterventionConfidence;
  title: string;
  /** Explainable, data-derived reason. Never AI-generated in Phase 3.2. */
  reason: string;
  suggestedAction: InterventionSuggestedAction;
  sourceSignals: string[];
  /** Stable fingerprint so clients can suppress repeat display of the same advice. */
  fingerprint: string;
  facts: InterventionFacts;
}

export interface StackCandidate {
  habitId: string;
  title: string;
  rate30: number;
}

export interface CrossHabitInsight {
  activeHabits: number;
  /** Siblings whose 30-day miss rate meets the overload floor. */
  habitsAtRisk: number;
  avgMissRate30: number | null;
}

/**
 * Everything the pure engine needs beyond the BehaviorReport.
 * Loaded by the service; contains no behavior objects and no IO handles.
 */
export interface InterventionHabitContext {
  habitId: string;
  habitTitle: string;
  todayKey: string;
  cueTime: string | null;
  fullBehavior: string | null;
  minimumBehavior: string | null;
  emergencyMinimum: string | null;
  /** Whether the habit's schedule makes today an expected day. */
  scheduledToday: boolean;
  hasExistingStack: boolean;
  stackCandidate: StackCandidate | null;
  identityTitle: string | null;
  completionsLast30: number;
  crossHabit: CrossHabitInsight | null;
}
