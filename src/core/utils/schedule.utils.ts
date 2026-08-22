/**
 * Pure scheduling helpers shared by the reward engine, streak freeze and
 * recovery system. All date arithmetic uses plain `YYYY-MM-DD` day keys so
 * results never depend on the server timezone.
 */

const DAY_MS = 86_400_000;

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parses a YYYY-MM-DD key into a UTC-noon Date (immune to DST shifts). */
export const parseDayKey = (key: string): Date =>
  new Date(`${key}T12:00:00.000Z`);

export const shiftDayKey = (key: string, days: number): string =>
  new Date(parseDayKey(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetweenKeys = (from: string, to: string): number =>
  Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / DAY_MS);

export const weekdayKeyOf = (key: string): string =>
  WEEKDAY_KEYS[parseDayKey(key).getUTCDay()];

export interface HabitScheduleShape {
  scheduleType?: string | null;
  scheduleDays?: string[] | null;
  timesPerWeek?: number | null;
  intervalDays?: number | null;
  startDate?: Date | string | null;
}

/**
 * Whether the habit expects the user to act on the given day.
 *
 * - daily / unset: every day
 * - specific_days: only the configured weekdays
 * - times_per_week: no fixed days; treated as eligible any day (the weekly
 *   quota is enforced by analytics, not by per-day eligibility)
 * - interval: every Nth day from the habit start (or from the epoch key)
 */
export const isScheduledOnDate = (
  habit: HabitScheduleShape,
  dateKey: string,
): boolean => {
  switch (habit.scheduleType) {
    case 'specific_days': {
      const days = habit.scheduleDays ?? [];
      if (days.length === 0) return true;
      return days.includes(weekdayKeyOf(dateKey));
    }
    case 'interval': {
      const interval = habit.intervalDays ?? 1;
      if (interval <= 1) return true;
      const anchor =
        habit.startDate instanceof Date
          ? habit.startDate.toISOString().slice(0, 10)
          : ((habit.startDate as string | null | undefined)?.slice(0, 10) ??
            '2026-01-01');
      if (dateKey < anchor) return false;
      return daysBetweenKeys(anchor, dateKey) % interval === 0;
    }
    case 'times_per_week':
      return true;
    default:
      return true;
  }
};

/** Count of scheduled occurrences in the N days ending at (and including) endDate. */
export const countScheduledDays = (
  habit: HabitScheduleShape,
  endDate: string,
  windowDays: number,
): string[] => {
  const scheduled: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const key = shiftDayKey(endDate, -i);
    if (isScheduledOnDate(habit, key)) scheduled.push(key);
  }
  return scheduled;
};
