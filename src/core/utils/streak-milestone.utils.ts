import { shiftDayKey } from './schedule.utils';

export interface CurrentStreak {
  /** Consecutive satisfied days ending at endDate (completed or frozen). */
  streak: number;
  /** First day key of the current streak run; equals endDate when streak is 0/1. */
  cycleStart: string;
}

/**
 * Streak ending at `endDate`, walking backwards day by day. A day keeps the
 * run alive when it was completed OR protected by a streak freeze; the first
 * gap ends the run. Pure and timezone-free: operates on YYYY-MM-DD keys.
 */
export const computeCurrentStreak = (
  completedKeys: Iterable<string>,
  endDate: string,
  frozenKeys: Iterable<string> = [],
): CurrentStreak => {
  const done = new Set(completedKeys);
  const frozen = new Set(frozenKeys);

  let streak = 0;
  let cursor = endDate;
  while (done.has(cursor) || frozen.has(cursor)) {
    // Frozen-but-not-completed days preserve the run without becoming it.
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
    if (streak > 3650) break; // safety valve
  }
  return { streak, cycleStart: shiftDayKey(cursor, 1) };
};

/**
 * Whether a historical milestone cycle (milestone consecutive days starting
 * at cycleStart) is still fully intact — used to decide whether an existing
 * milestone award must be reversed after a toggle-off.
 */
export const isMilestoneCycleIntact = (
  completedKeys: Iterable<string>,
  cycleStart: string,
  milestone: number,
  frozenKeys: Iterable<string> = [],
): boolean => {
  const done = new Set(completedKeys);
  const frozen = new Set(frozenKeys);
  for (let i = 0; i < milestone; i++) {
    const key = shiftDayKey(cycleStart, i);
    if (!done.has(key) && !frozen.has(key)) return false;
  }
  return true;
};
