/**
 * Phase 3.7 — adaptive cadence configuration.
 *
 * Every threshold is named, documented, deterministic and unit-tested.
 * Frequency controls SURFACING only — never behavioral truth.
 */

export const NOTIFICATION_TYPES = [
  'HABIT_AT_RISK',
  'RECOVERY_NEEDED',
  'DIFFICULTY_TOO_HIGH',
  'WEEKDAY_RISK',
  'TIME_RISK',
  'MOMENTUM_PROTECTION',
  'OVERLOAD_DETECTED',
  'ADAPTIVE_PROPOSAL_AVAILABLE',
  'ADAPTATION_OUTCOME',
  'WEEKLY_REVIEW_READY',
  'IDENTITY_REINFORCEMENT',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';

/** Intervention-priority → notification-priority (single authoritative map). */
export const PRIORITY_MAP: Record<number, NotificationPriority> = {
  100: 'URGENT', // CRITICAL risk recovery
  92: 'HIGH', // REDUCE_DIFFICULTY
  88: 'HIGH', // weekday (high band)
  84: 'NORMAL', // CHANGE_TIME
  82: 'HIGH', // OVERLOAD
  80: 'NORMAL', // DECLINING recovery
  78: 'NORMAL', // AT_RISK nudge
  76: 'LOW', // PROTECT_MOMENTUM
  74: 'NORMAL', // weekday prep (quiet band)
  70: 'LOW', // REINFORCE_IDENTITY
};

/** Cooldown days per type — same condition cannot re-fire inside this window. */
export const COOLDOWN_DAYS: Record<NotificationType, number> = {
  HABIT_AT_RISK: 3,
  RECOVERY_NEEDED: 2,
  DIFFICULTY_TOO_HIGH: 7,
  WEEKDAY_RISK: 7,
  TIME_RISK: 7,
  MOMENTUM_PROTECTION: 5,
  OVERLOAD_DETECTED: 7,
  ADAPTIVE_PROPOSAL_AVAILABLE: 2,
  ADAPTATION_OUTCOME: 365, // one-shot per evaluated proposal fingerprint
  WEEKLY_REVIEW_READY: 8, // ISO-week cadence with slack
  IDENTITY_REINFORCEMENT: 10,
};

/** Default quiet hours in the USER'S local wall clock (24h minutes). */
export const QUIET_HOURS = {
  START_MIN: 22 * 60, // 22:00
  END_MIN: 7 * 60 + 30, // 07:30
} as const;

/** Hard ceiling per user per day — even FREQUENT never spams past this. */
export const MAX_PER_DAY = 3;

/** Phase 3.4 frequency tiers → which priorities may surface. */
export const FREQUENCY_PRIORITY_FLOOR: Record<
  string,
  number // minimum intervention priority allowed to surface
> = {
  MINIMAL: 90, // effectively recovery/critical only
  STANDARD: 70, // everything the current engine produces except lowest
  FREQUENT: 60, // all meaningful interventions incl. identity/momentum
};
