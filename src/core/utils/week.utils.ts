import { shiftDayKey } from './schedule.utils';

/**
 * Phase 3.4 — THE canonical week-boundary utility.
 *
 * Weeks are Monday 00:00 → Sunday 23:59:59 in the USER'S calendar. Because
 * the whole app already operates on user-local day keys (YYYY-MM-DD), week
 * math is pure day-key arithmetic; the timezone only decides which local
 * day is "today" when the client does not supply a date.
 *
 * Every weekly feature MUST use these two functions — no ad-hoc date math.
 */

export interface WeekRange {
  /** Monday day key, e.g. "2026-08-17". */
  start: string;
  /** Sunday day key, e.g. "2026-08-23". */
  end: string;
}

const DAY_MS = 86_400_000;

const weekdayIndexOf = (dateKey: string): number =>
  new Date(`${dateKey}T12:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat

/** Monday of the week containing `dateKey`. */
export const mondayOf = (dateKey: string): string => {
  const idx = weekdayIndexOf(dateKey);
  return shiftDayKey(dateKey, -((idx + 6) % 7));
};

/** The Mon..Sun range containing `dateKey`. */
export const weekRangeFor = (dateKey: string): WeekRange => {
  const start = mondayOf(dateKey);
  return { start, end: shiftDayKey(start, 6) };
};

/** The range of the week immediately before the given range. */
export const previousWeekRange = (range: WeekRange): WeekRange => ({
  start: shiftDayKey(range.start, -7),
  end: shiftDayKey(range.start, -1),
});

/**
 * Resolves the analysis day key for a weekly request.
 * - explicit `?week=` date (validated): that day's week is used;
 * - otherwise: TODAY in the user's timezone (UTC fallback), so a user in
 *   Karachi sees their new week open at their own midnight, not UTC's.
 */
export const resolveWeeklyAnalysisDate = (
  weekParam: string | undefined,
  timezone: string | null | undefined,
): { todayKey: string; range: WeekRange } => {
  let todayKey: string;
  if (weekParam !== undefined && weekParam !== null && weekParam !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      throw new WeeklyDateError('week must be formatted as YYYY-MM-DD');
    }
    const parsed = new Date(`${weekParam}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== weekParam
    ) {
      throw new WeeklyDateError('week must be a valid calendar date');
    }
    todayKey = weekParam;
  } else {
    // Local YYYY-MM-DD in the user's zone (UTC fallback for unset zones).
    todayKey = localDateKeyInZone(timezone);
  }
  return { todayKey, range: weekRangeFor(todayKey) };
};

/** Local calendar date key (YYYY-MM-DD) for an instant in a zone. */
export const localDateKeyInZone = (
  timezone: string | null | undefined,
  instant: string = new Date().toISOString(),
): string => {
  const tz = timezone?.trim() || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant));
    return parts; // en-CA yields ISO-like YYYY-MM-DD
  } catch {
    return instant.slice(0, 10);
  }
};

/**
 * Rolling 7-day week anchored to the user's account creation date.
 *
 * Week 1 = [createdAt, createdAt+6], Week 2 = [createdAt+7, createdAt+13], etc.
 * This replaces calendar Mon–Sun weeks so every user gets their first review
 * exactly7 days after sign-up, regardless of which day they joined.
 */
export const userWeekRangeFor = (
  createdAt: Date,
  todayKey: string,
): { range: WeekRange; weekNumber: number } => {
  const createdLocal = localDateKeyInZone(null, createdAt.toISOString());
  const dayMs = DAY_MS;
  const createdMs = new Date(`${createdLocal}T12:00:00.000Z`).getTime();
  const todayMs = new Date(`${todayKey}T12:00:00.000Z`).getTime();
  const daysSinceCreation = Math.floor((todayMs - createdMs) / dayMs);
  if (daysSinceCreation < 0) {
    return {
      range: { start: createdLocal, end: shiftDayKey(createdLocal, 6) },
      weekNumber: 1,
    };
  }
  const weekIndex = Math.floor(daysSinceCreation / 7);
  const weekStart = shiftDayKey(createdLocal, weekIndex * 7);
  return {
    range: { start: weekStart, end: shiftDayKey(weekStart, 6) },
    weekNumber: weekIndex + 1,
  };
};

/**
 * Whether the user's current rolling week has completed (i.e. today is at
 * least 7 days after account creation and falls outside the current week).
 */
export const isUserWeekComplete = (
  createdAt: Date,
  todayKey: string,
): boolean => {
  const { range } = userWeekRangeFor(createdAt, todayKey);
  return todayKey > range.end;
};

export class WeeklyDateError extends Error {}

export const daysBetweenInclusive = (startKey: string, endKey: string): number =>
  Math.round(
    (new Date(`${endKey}T12:00:00.000Z`).getTime() -
      new Date(`${startKey}T12:00:00.000Z`).getTime()) /
      DAY_MS,
  ) + 1;
