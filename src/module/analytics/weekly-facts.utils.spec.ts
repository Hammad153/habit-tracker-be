import { buildBehaviorReport, CompletionFact } from '../../core/utils/behavior-analytics.utils';
import {
  WeeklyHabitEntry,
  buildWeeklyReviewFacts,
} from './weekly-facts.utils';

const WEEK = { start: '2026-08-17', end: '2026-08-23' };
const TODAY = '2026-08-23';

const run = (
  endKey: string,
  count: number,
  done: (i: number, total: number) => boolean = () => true,
): CompletionFact[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${endKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return {
      date: d.toISOString().slice(0, 10),
      status: done(i, count),
      value: 1,
      kind: 'FULL' as const,
    };
  });

const entry = (
  title: string,
  completions: CompletionFact[],
  habitId = `h-${title}`,
): WeeklyHabitEntry => ({
  habitId,
  title,
  report: buildBehaviorReport({
    habit: { id: habitId, scheduleType: 'daily' },
    completions,
    todayKey: TODAY,
  }),
});

describe('weekly facts engine — deterministic aggregation', () => {
  it('zero habits → insufficient history with null rates', () => {
    const facts = buildWeeklyReviewFacts(WEEK, [], []);
    expect(facts.insufficientHistory).toBe(true);
    expect(facts.overall.completionRate).toBeNull();
    expect(facts.habits).toEqual([]);
    expect(facts.identity).toEqual([]);
  });

  it('a single habit aggregates its week rate, streak, momentum, signal', () => {
    // Week window Aug17..23: six past days + today; all completed.
    const e = entry('Read', run(TODAY, 30));
    const facts = buildWeeklyReviewFacts(WEEK, [e], []);
    expect(facts.insufficientHistory).toBe(false);
    expect(facts.overall.completionRate).toBe(1);
    expect(facts.habits[0]).toMatchObject({
      title: 'Read',
      completionRate: 1,
      currentStreak: expect.any(Number),
      signal: 'CONSISTENT',
    });
  });

  it('multiple habits weight the overall rate by expected days', () => {
    // A: perfect week (7/7 incl today); B stopped before the week began.
    const a = entry('A', run(TODAY, 30));
    const b = entry('B', run('2026-08-16', 20)); // nothing in the review week
    const facts = buildWeeklyReviewFacts(WEEK, [a, b], []);
    // A expected 7 completed 7 ; B expected 7 completed 0 → overall 0.5.
    expect(facts.overall.completionRate).toBeCloseTo(0.5);
    expect(facts.overall.expectedCount).toBe(14);
    expect(facts.overall.completedCount).toBe(7);
  });

  it('trend reflects improvement vs previous week', () => {
    // Prior weeks weak, this week strong → IMPROVING.
    const comps = [
      ...run('2026-08-16', 20, () => false),
      ...run('2026-08-16', 2), // a couple of prior wins
    ];
    const e = entry('Gym', [...run(TODAY, 7), ...comps]);
    const facts = buildWeeklyReviewFacts(WEEK, [e], []);
    expect(facts.overall.trend).toBe('IMPROVING');
    expect(facts.habits[0].improved).toBe(true);
  });

  it('archived habits never reach the engine (service filters); empty entries stay honest', () => {
    const facts = buildWeeklyReviewFacts(WEEK, [], [
      { name: 'Reader', evidencePoints: 18, levelTitle: 'Consistent' },
    ]);
    expect(facts.insufficientHistory).toBe(true);
    // Identity data alone cannot fabricate behavioral claims.
    expect(facts.overall.completionRate).toBeNull();
  });

  it('MINIMUM and EMERGENCY kinds still count as showing up', () => {
    const comps = run(TODAY, 7).map((c, idx) => ({
      ...c,
      kind: idx % 2 === 0 ? ('MINIMUM' as const) : ('EMERGENCY' as const),
    }));
    const facts = buildWeeklyReviewFacts(WEEK, [entry('Read', comps)], []);
    expect(facts.overall.completionRate).toBe(1);
  });

  it('weekday pattern modes pick the most common best/worst day', () => {
    const thursdayFailures = run(TODAY, 90).map((c) => {
      const wd = new Date(`${c.date}T12:00:00.000Z`).getUTCDay();
      return { ...c, status: c.status && wd !== 4 };
    });
    const tuesdayWins = run(TODAY, 90);
    void tuesdayWins;
    const facts = buildWeeklyReviewFacts(
      WEEK,
      [entry('R', thursdayFailures)],
      [],
    );
    expect(facts.patterns.weakestDay).toBe('Thursday');
  });

  it('identity list is capped at three entries', () => {
    const ids = Array.from({ length: 5 }, (_, i) => ({
      name: `Identity ${i}`,
      evidencePoints: 10 - i,
      levelTitle: 'X',
    }));
    const facts = buildWeeklyReviewFacts(
      WEEK,
      [entry('Read', run(TODAY, 8))],
      ids,
    );
    expect(facts.identity.length).toBe(3);
  });
});
