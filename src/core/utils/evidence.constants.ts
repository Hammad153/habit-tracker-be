export const MAX_IDENTITY_LEVEL = 5;

/** Virtual currency awarded per successful completion, by kind. */
export const COINS_PER_COMPLETION: Record<'FULL' | 'MINIMUM' | 'EMERGENCY', number> = {
  FULL: 10,
  MINIMUM: 3,
  EMERGENCY: 2,
};

/** Streak milestone bonuses – tiered configuration. */
export const STREAK_MILESTONE_BONUSES: Record<number, number> = {
  3: 5,
  7: 25,
  14: 50,
  30: 100,
  60: 250,
  100: 500,
};

// Legacy default (used when a milestone is not in the map)
export const DEFAULT_STREAK_MILESTONE_BONUS = 25;

// Freeze cost – coins deducted when buying a one‑day streak protect.
export const STREAK_FREEZE_COST = 100;
