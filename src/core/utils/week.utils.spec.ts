import {
  daysBetweenInclusive,
  localDateKeyInZone,
  mondayOf,
  previousWeekRange,
  resolveWeeklyAnalysisDate,
  weekRangeFor,
  WeeklyDateError,
} from './week.utils';

describe('week utils — canonical Monday-based ranges', () => {
  it('a Monday maps to itself', () => {
    expect(mondayOf('2026-08-17')).toBe('2026-08-17'); // Monday
    expect(weekRangeFor('2026-08-17')).toEqual({ start: '2026-08-17', end: '2026-08-23' });
  });

  it('a Sunday closes its own week and does not roll forward', () => {
    expect(weekRangeFor('2026-08-23')).toEqual({ start: '2026-08-17', end: '2026-08-23' });
    // The next day opens a NEW week.
    expect(weekRangeFor('2026-08-24')).toEqual({ start: '2026-08-24', end: '2026-08-30' });
  });

  it('mid-week days map back to their Monday', () => {
    expect(mondayOf('2026-08-19')).toBe('2026-08-17'); // Wednesday
    expect(mondayOf('2026-08-23')).toBe('2026-08-17'); // Sunday
  });

  it('handles month boundaries', () => {
    // Sat 2026-08-01 belongs to the July week starting Mon 2026-07-27.
    expect(weekRangeFor('2026-08-01')).toEqual({ start: '2026-07-27', end: '2026-08-02' });
    expect(weekRangeFor('2026-07-31')).toEqual({ start: '2026-07-27', end: '2026-08-02' });
  });

  it('handles year boundaries incl. leap-adjacent years', () => {
    // Fri 2027-01-01 -> week starts Mon 2026-12-28.
    expect(weekRangeFor('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    // Sat 2028-01-01 -> week starts Mon 2027-12-27 and ends in the new year.
    expect(weekRangeFor('2028-01-01')).toEqual({ start: '2027-12-27', end: '2028-01-02' });
  });

  it('previousWeekRange is exactly seven days earlier', () => {
    const prev = previousWeekRange({ start: '2026-08-17', end: '2026-08-23' });
    expect(prev).toEqual({ start: '2026-08-10', end: '2026-08-16' });
    expect(daysBetweenInclusive(prev.start, prev.end)).toBe(7);
  });

  it('every range spans exactly seven days', () => {
    for (const day of ['2026-02-28', '2024-02-29', '2026-12-31']) {
      const r = weekRangeFor(day);
      expect(daysBetweenInclusive(r.start, r.end)).toBe(7);
      expect(new Date(`${r.start}T12:00:00.000Z`).getUTCDay()).toBe(1); // Monday
      expect(new Date(`${r.end}T12:00:00.000Z`).getUTCDay()).toBe(0); // Sunday
    }
  });

  it('resolves today in the user timezone for implicit requests', () => {
    // 2026-08-22 21:30 UTC == Aug 23 in Karachi (+05:00).
    // new Date().toISOString() drives implicit "today" resolution.
    const isoSpy = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-08-22T21:30:00.000Z');
    try {
      const { todayKey } = resolveWeeklyAnalysisDate(undefined, 'Asia/Karachi');
      expect(todayKey).toBe(
        localDateKeyInZone('Asia/Karachi', '2026-08-22T21:30:00.000Z'),
      );
      expect(todayKey).toBe('2026-08-23'); // already Sunday for Karachi
      // Same instant in UTC is still Saturday.
      expect(resolveWeeklyAnalysisDate(undefined, null).todayKey).toBe('2026-08-22');
    } finally {
      isoSpy.mockRestore();
    }
  });

  it('explicit week params win over timezone resolution', () => {
    const { todayKey, range } = resolveWeeklyAnalysisDate('2026-01-05', null);
    expect(todayKey).toBe('2026-01-05');
    expect(range).toEqual({ start: '2026-01-05', end: '2026-01-11' });
  });

  it('rejects malformed and impossible dates before any work', () => {
    expect(() => resolveWeeklyAnalysisDate('not-a-date', null)).toThrow(WeeklyDateError);
    expect(() => resolveWeeklyAnalysisDate('2026/08/23', null)).toThrow(WeeklyDateError);
    expect(() => resolveWeeklyAnalysisDate('2026-13-40', null)).toThrow(WeeklyDateError);
  });

  it('falls back to UTC on invalid timezones instead of crashing', () => {
    expect(localDateKeyInZone('Not/AZone', '2026-08-22T09:00:00.000Z')).toBe('2026-08-22');
  });
});
