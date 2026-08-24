import {
  COOLDOWN_DAYS,
  FREQUENCY_PRIORITY_FLOOR,
  MAX_PER_DAY,
  NOTIFICATION_TYPES,
  type NotificationPriority,
  type NotificationType,
  PRIORITY_MAP,
  QUIET_HOURS,
} from './adaptive-cadence.constants';

/**
 * Phase 3.7 — pure adaptive cadence engine.
 *
 * Decides WHETHER a deterministic insight may be surfaced. No IO, no AI:
 * identical inputs always yield identical decisions. Frequency preferences
 * gate SURFACING only — they can never validate an invalid intervention.
 */

export interface CadenceInput {
  type: NotificationType;
  /** Intervention priority (Phase 3.2 scale) driving the notification. */
  interventionPriority: number;
  fingerprint: string;
  todayKey: string; // YYYY-MM-DD user-local
  /** Current local wall-clock minutes since midnight (user timezone). */
  localMinutes: number;
  coachEnabled: boolean;
  weeklyReviewEnabled: boolean;
  /** Phase 3.4 tier: MINIMAL | STANDARD | FREQUENT (unknown → STANDARD). */
  coachFrequency: string;
  /** For habit-scoped types: whether the habit expects action today. */
  scheduledToday?: boolean;
  completedToday?: boolean;
  /** Fingerprints delivered within their cooldown window. */
  recentlyDeliveredFingerprints: Set<string>;
  /** Deliveries already counted today (any type). */
  deliveriesToday: number;
}

export interface CadenceDecision {
  eligible: boolean;
  priority: NotificationPriority;
  reason: string;
}

/** Priority derived ONLY from the intervention hierarchy (spec §8). */
export const priorityFor = (
  interventionPriority: number,
  type: NotificationType,
): NotificationPriority =>
  PRIORITY_MAP[interventionPriority] ??
  (type === 'OVERLOAD_DETECTED'
    ? 'HIGH'
    : type === 'WEEKLY_REVIEW_READY'
      ? 'LOW'
      : 'NORMAL');

export const inQuietHours = (localMinutes: number): boolean => {
  const { START_MIN, END_MIN } = QUIET_HOURS;
  return localMinutes >= START_MIN || localMinutes < END_MIN;
};

export const cooldownDaysFor = (type: NotificationType): number =>
  COOLDOWN_DAYS[type] ?? 7;

const frequencyFloor = (coachFrequency: string): number => {
  const normalized = String(coachFrequency ?? '').toUpperCase();
  return (
    FREQUENCY_PRIORITY_FLOOR[normalized] ??
    FREQUENCY_PRIORITY_FLOOR.STANDARD
  );
};

/**
 * Canonical cadence decision. Order matters: cheap preference gates first;
 * the CRITICAL safety bypass runs last and overrides frequency suppression
 * only — it can never resurrect a denied-by-preference or spam-guarded item.
 */
export const evaluateCadence = (input: CadenceInput): CadenceDecision => {
  const deny = (reason: string): CadenceDecision => ({
    eligible: false,
    priority: priorityFor(input.interventionPriority, input.type),
    reason,
  });

  if (!NOTIFICATION_TYPES.includes(input.type)) return deny('unknown-type');

  // ---- Preference gates ---------------------------------------------------
  if (!input.coachEnabled && input.type !== 'WEEKLY_REVIEW_READY') {
    return deny('coach-disabled');
  }
  if (input.type === 'WEEKLY_REVIEW_READY' && !input.weeklyReviewEnabled) {
    return deny('weekly-review-disabled');
  }

  // ---- Habit-context gates (habit-scoped types only) ----------------------
  const habitScoped =
    input.type !== 'WEEKLY_REVIEW_READY' &&
    input.type !== 'OVERLOAD_DETECTED' &&
    input.type !== 'ADAPTATION_OUTCOME';
  if (habitScoped) {
    if (input.scheduledToday === false) return deny('not-scheduled-today');
    if (input.completedToday === true) return deny('completed-today');
  }

  // ---- Spam protection ----------------------------------------------------
  if (!input.fingerprint) return deny('missing-fingerprint');
  if (input.recentlyDeliveredFingerprints.has(input.fingerprint)) {
    return deny('cooldown');
  }
  if (input.deliveriesToday >= MAX_PER_DAY) return deny('daily-cap');

  // ---- Timing -------------------------------------------------------------
  if (inQuietHours(input.localMinutes)) return deny('quiet-hours');

  // ---- Safety bypass: CRITICAL band overrides frequency suppression ------
  if (input.interventionPriority >= 100) {
    return { eligible: true, priority: 'URGENT', reason: 'critical-bypass' };
  }

  // ---- Frequency policy (surfacing only) ---------------------------------
  // Lifecycle notifications (weekly review / outcomes) are gated by their own
  // toggles + one-shot cooldowns, NOT by intervention-priority floors.
  const lifecycle =
    input.type === 'WEEKLY_REVIEW_READY' ||
    input.type === 'ADAPTATION_OUTCOME';
  if (!lifecycle) {
    const minPriority = frequencyFloor(input.coachFrequency);
    if (input.interventionPriority < minPriority) {
      return deny(`frequency-below-floor:${minPriority}`);
    }
  }

  return {
    eligible: true,
    priority: priorityFor(input.interventionPriority, input.type),
    reason: 'cadence-pass',
  };
};
