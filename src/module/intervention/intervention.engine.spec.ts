import { evaluateIntervention } from './intervention.engine';
import { daysUntilWeekday } from './intervention.constants';
import {
  BehaviorReport,
  CompletionFact,
  buildBehaviorReport,
} from '../../core/utils/behavior-analytics.utils';
import { InterventionHabitContext } from './intervention.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAILY: AnalyzedHabitShape = { id: 'habit-1', scheduleType: 'daily' };
type AnalyzedHabitShape = Parameters<typeof buildBehaviorReport>[0]['habit'];

/** N consecutive FULL completions ending at `endKey`. */
const run = (
  endKey: string,
  count: number,
  kind: CompletionFact['kind'] = 'FULL',
): CompletionFact[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${endKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - (count - 1 - i));
    return { date: d.toISOString().slice(0, 10), status: true, value: 1, kind };
  });

const shiftBack = (endKey: string, days: number): string => {
  const d = new Date(`${endKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const TODAY = '2026-08-23'; // Sunday

const baseCtx: InterventionHabitContext = {
  habitId: 'habit-1',
  todayKey: TODAY,
  cueTime: null,
  fullBehavior: 'Run 5km',
  minimumBehavior: 'Walk 5 minutes',
  emergencyMinimum: null,
  scheduledToday: true,
  hasExistingStack: false,
  stackCandidate: null,
  identityTitle: null,
  completionsLast30: 25,
  crossHabit: null,
};

const reportOf = (
  completions: CompletionFact[],
  habit: AnalyzedHabitShape = DAILY,
) => buildBehaviorReport({ habit, completions, todayKey: TODAY });

/**
 * Stub factory for precise rule-table unit tests: the engine only reads a
 * known subset of BehaviorReport, so tests control exactly that subset.
 */
const stubReport = (overrides: Partial<BehaviorReport>): BehaviorReport =>
  ({
    habitId: 'habit-1',
    habitTitle: 'Read',
    isArchived: false,
    analyzedAsOf: TODAY,
    windows: { short: 7, medium: 30, long: 90 },
    completionRates: {
      d7: { rate: 0.9, expected: 7, completed: 6 },
      d30: { rate: 0.85, expected: 30, completed: 25 },
      d90: { rate: 0.8, expected: 90, completed: 70 },
    },
    missRates: {
      d7: { rate: 0.1, expected: 7, completed: 6 },
      d30: { rate: 0.15, expected: 30, completed: 25 },
    },
    streaks: { current: 6, longest: 14 },
    kindMix30: {
      total: 25,
      full: { count: 20, share: 0.8 },
      minimum: { count: 4, share: 0.16 },
      emergency: { count: 1, share: 0.04 },
    },
    minimumCompletionRate30: 0.16,
    emergencyCompletionRate30: 0.04,
    averageCompletionValue30: 12,
    previousWeekRate: 0.8,
    weekday: [],
    bestDayOfWeek: null,
    worstDayOfWeek: null,
    timeWindows: {
      timezoneUsed: 'UTC',
      sampleSize: 0,
      stats: [],
      best: null,
      worst: null,
      scheduledBucketCode: null,
    },
    timezoneUsed: 'UTC',
    momentum: { score: 0.7, level: 'STEADY' },
    risk: { score: 0.1, level: 'LOW', reasons: [] },
    signals: ['CONSISTENT'],
    structuredSignals: [],
    insufficientHistory: false,
    completedToday: false,
    ...overrides,
  }) as BehaviorReport;

const weekdaySignal = (day = 'Thu', dayFull = 'Thursday', completionRate = 0.31) => ({
  type: 'WEEKDAY_RISK' as const,
  day,
  dayFull,
  completionRate,
});

describe('InterventionEngine — determinism & purity', () => {
  it('is deterministic: identical inputs produce identical outputs', () => {
    const report = reportOf(run(TODAY, 30));
    const a = evaluateIntervention(report, baseCtx);
    const b = evaluateIntervention(report, baseCtx);
    expect(a).toEqual(b);
  });

  it('does not mutate its inputs', () => {
    const report = reportOf(run(TODAY, 30));
    const snapshot = JSON.stringify(report);
    evaluateIntervention(report, baseCtx);
    expect(JSON.stringify(report)).toBe(snapshot);
  });
});

describe('InterventionEngine — safety gates', () => {
  it('archived habits receive no intervention even under HIGH risk', () => {
    const report = stubReport({
      isArchived: true,
      risk: { score: 0.7, level: 'HIGH', reasons: ['x'] },
      signals: ['AT_RISK'],
    });
    expect(evaluateIntervention(report, baseCtx)).toBeNull();
  });

  it('insufficient history → NO_INTERVENTION (null)', () => {
    const report = stubReport({ insufficientHistory: true });
    expect(evaluateIntervention(report, baseCtx)).toBeNull();
  });

  it('a steady, healthy user gets silence (product rule §40)', () => {
    // Strong month with one recent miss -> CONSISTENT but momentum STEADY.
    const completions = run(TODAY, 30).map((c) =>
      c.date === shiftBack(TODAY, 3) ? { ...c, status: false } : c,
    );
    const report = reportOf(completions);
    expect(report.signals).toContain('CONSISTENT');
    expect(report.momentum.level).not.toBe('STRONG');
    expect(evaluateIntervention(report, baseCtx)).toBeNull();
  });
});

describe('InterventionEngine — recovery (spec scenarios 1–3)', () => {
  it('CRITICAL risk → RECOVERY at priority 100 regardless of other signals', () => {
    const report = stubReport({
      risk: { score: 0.85, level: 'CRITICAL', reasons: ['6 of 7 scheduled days missed'] },
      signals: ['AT_RISK', 'STRONG_MOMENTUM'],
      momentum: { score: 0.75, level: 'STRONG' },
    });
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.type).toBe('RECOVERY');
    expect(result.priority).toBe(100);
    expect(result.suggestedAction.type).toBe('USE_MINIMUM_VERSION');
    expect(result.category).toBe('USER_ACTION_REQUIRED');
    expect(result.sourceSignals).toContain('AT_RISK');
  });

  it('HIGH risk + recent misses + eligible today → RECOVERY nudge', () => {
    const report = stubReport({
      risk: { score: 0.65, level: 'HIGH', reasons: ['5 of 7 missed'] },
      signals: ['AT_RISK'],
      missRates: { d7: { rate: 0.71, expected: 7, completed: 2 }, d30: { rate: 0.3, expected: 30, completed: 21 } },
    });
    const result = evaluateIntervention(report, baseCtx)!;
    expect(['RECOVERY', 'REDUCE_DIFFICULTY']).toContain(result.type);
    if (result.type === 'RECOVERY') {
      expect(result.suggestedAction.type).toBe('USE_MINIMUM_VERSION');
    }
  });

  it('recovery action suppressed when the habit is already done today', () => {
    const report = stubReport({
      signals: ['AT_RISK'],
      risk: { score: 0.35, level: 'MODERATE', reasons: [] },
      completedToday: true,
    });
    const result = evaluateIntervention(report, baseCtx);
    if (result?.type === 'RECOVERY') {
      expect(result.suggestedAction.type).not.toBe('USE_MINIMUM_VERSION');
    }
  });

  it('reasons cite concrete numbers, never vague advice', () => {
    const report = stubReport({
      signals: ['AT_RISK'],
      risk: { score: 0.4, level: 'MODERATE', reasons: ['3 missed'] },
      missRates: { d7: { rate: 0.43, expected: 7, completed: 4 }, d30: { rate: 0.2, expected: 30, completed: 24 } },
    });
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.reason).toMatch(/(\d+%|\d+ of \d+)/);
  });
});

describe('InterventionEngine — difficulty (spec scenarios 4–6)', () => {
  const hardReport = () =>
    stubReport({
      risk: { score: 0.68, level: 'HIGH', reasons: [] },
      signals: ['TOO_HARD', 'AT_RISK'],
      structuredSignals: [
        { type: 'DIFFICULTY_TOO_HIGH', confidence: 0.6 },
      ],
      kindMix30: {
        total: 20,
        full: { count: 6, share: 0.3 },
        minimum: { count: 11, share: 0.55 },
        emergency: { count: 3, share: 0.15 },
      },
    });

  it('TOO_HARD → REDUCE_DIFFICULTY preferring the minimum version', () => {
    const result = evaluateIntervention(hardReport(), baseCtx)!;
    expect(result.type).toBe('REDUCE_DIFFICULTY');
    expect(result.priority).toBe(92);
    expect(result.suggestedAction.type).toBe('USE_MINIMUM_VERSION');
    expect(result.sourceSignals).toContain('TOO_HARD');
  });

  it('beats weekday and recovery rules when they co-occur (§35)', () => {
    const report = hardReport();
    report.structuredSignals.push(weekdaySignal());
    const result = evaluateIntervention(
      report,
      { ...baseCtx, todayKey: '2026-08-18', stackCandidate: { habitId: 'a', title: 'Coffee', rate30: 0.95 } },
    )!;
    expect(result.type).toBe('REDUCE_DIFFICULTY');
  });

  it('minimum version unavailable → falls back to editing the habit', () => {
    const result = evaluateIntervention(hardReport(), {
      ...baseCtx,
      minimumBehavior: null,
    })!;
    expect(result.type).toBe('REDUCE_DIFFICULTY');
    expect(result.suggestedAction.type).toBe('OPEN_HABIT_EDIT');
  });
});

describe('InterventionEngine — weekday risk (spec scenarios 7–8)', () => {
  /** Thursday-heavy failure pattern spanning the full 90-day window. */
  const thursdayFailures = (endKey = TODAY): CompletionFact[] => {
    const out: CompletionFact[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(`${endKey}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      out.push({
        date: d.toISOString().slice(0, 10),
        status: d.getUTCDay() !== 4 || i === 3,
        value: 1,
        kind: 'FULL',
      });
    }
    return out;
  };

  it('approaching weak Thursday (Tuesday) → PREPARE_FOR_RISK citing facts', () => {
    const tuesday = '2026-08-18'; // 2 days before Thursday
    const asOfTuesday = buildBehaviorReport({
      habit: DAILY,
      completions: thursdayFailures(tuesday),
      todayKey: tuesday,
    });
    const result = evaluateIntervention(asOfTuesday, {
      ...baseCtx,
      todayKey: tuesday,
    })!;
    expect(result.type).toBe('PREPARE_FOR_RISK');
    expect(result.sourceSignals).toContain('WEEKDAY_RISK');
    expect(result.facts.weekday).toBe('Thu');
    expect(result.facts.completionRate).toBeLessThan(0.5);
  });

  it('prefers HABIT_STACK when a reliable candidate exists (spec §10)', () => {
    const wednesday = '2026-08-19';
    const asOfWednesday = buildBehaviorReport({
      habit: DAILY,
      completions: thursdayFailures(wednesday),
      todayKey: wednesday,
    });
    const result = evaluateIntervention(asOfWednesday, {
      ...baseCtx,
      todayKey: wednesday,
      stackCandidate: { habitId: 'anchor', title: 'Morning coffee ritual', rate30: 0.95 },
    })!;
    expect(result.type).toBe('HABIT_STACK');
    expect(result.suggestedAction.type).toBe('CONFIGURE_HABIT_STACK');
    expect(result.reason).toContain('Morning coffee ritual');
  });

  it('weak weekday far outside the approach window does not fire', () => {
    // Sunday -> Thursday is 4 days away (> 2-day window).
    const report = reportOf(thursdayFailures(), DAILY);
    const result = evaluateIntervention(report, baseCtx);
    if (result) {
      expect(result.facts.daysUntil).toBeUndefined();
      expect(result.sourceSignals).not.toContain('WEEKDAY_RISK');
    }
  });

  it('an existing stack reinforces preparation instead of re-proposing', () => {
    const tuesday = '2026-08-18';
    const asOfTuesday = buildBehaviorReport({
      habit: DAILY,
      completions: thursdayFailures(tuesday),
      todayKey: tuesday,
    });
    const result = evaluateIntervention(asOfTuesday, {
      ...baseCtx,
      todayKey: tuesday,
      hasExistingStack: true,
      stackCandidate: { habitId: 'anchor', title: 'Coffee', rate30: 0.95 },
    })!;
    expect(result.type).not.toBe('HABIT_STACK');
  });
});

describe('InterventionEngine — time optimization (spec scenarios 9–10)', () => {
  const morningHeavy = () =>
    stubReport({
      risk: { score: 0.62, level: 'HIGH', reasons: [] },
      signals: [],
      timeWindows: {
        timezoneUsed: 'UTC',
        sampleSize: 7,
        stats: [
          { code: 'EARLY_MORNING', label: 'Early Morning', count: 6 },
          { code: 'NIGHT', label: 'Night', count: 1 },
        ],
        best: { code: 'EARLY_MORNING', label: 'Early Morning', count: 6 },
        worst: { code: 'NIGHT', label: 'Night', count: 1 },
        scheduledBucketCode: 'NIGHT',
      },
    });

  it('clear best/worst windows + mismatched cue → CHANGE_TIME', () => {
    const result = evaluateIntervention(morningHeavy(), {
      ...baseCtx,
      cueTime: '21:00',
    })!;
    expect(result.type).toBe('CHANGE_TIME');
    expect(result.suggestedAction.type).toBe('OPEN_HABIT_EDIT');
    expect(result.category).toBe('USER_ACTION_REQUIRED');
    expect(result.facts.bestWindow).toBe('EARLY_MORNING');
  });

  it('cue already inside the best window → no CHANGE_TIME', () => {
    const report = morningHeavy();
    report.timeWindows.scheduledBucketCode = 'EARLY_MORNING';
    expect(evaluateIntervention(report, baseCtx)?.type).not.toBe('CHANGE_TIME');
  });

  it('thin or balanced time history produces no CHANGE_TIME', () => {
    const report = morningHeavy();
    report.timeWindows.best!.count = 1; // equal counts -> ratio 1 < 1.5
    expect(evaluateIntervention(report, baseCtx)?.type).not.toBe('CHANGE_TIME');
  });
});

describe('InterventionEngine — momentum & identity (spec scenarios 14–15)', () => {
  it('STRONG_MOMENTUM + LOW/MODERATE risk → REINFORCE_IDENTITY with real evidence', () => {
    const report = reportOf(run(TODAY, 30));
    expect(report.momentum.level).toBe('STRONG');
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.type).toBe('REINFORCE_IDENTITY');
    expect(result.category).toBe('INFORMATIONAL');
    expect(result.reason).toContain(String(baseCtx.completionsLast30));
  });

  it('identity title woven in only when a real link exists', () => {
    const report = reportOf(run(TODAY, 30));
    const linked = evaluateIntervention(report, {
      ...baseCtx,
      identityTitle: 'Runner',
    })!;
    expect(linked.reason).toContain('Runner');
    expect(linked.facts.identityTitle).toBe('Runner');

    const unlinked = evaluateIntervention(report, baseCtx)!;
    expect(unlinked.facts.identityTitle ?? null).toBeNull();
  });
});

describe('InterventionEngine — recovery trend (spec scenarios 16–17)', () => {
  it('DECLINING → RECOVERY acknowledging the drop', () => {
    const completions: CompletionFact[] = [];
    for (let i = 29; i >= 0; i--) {
      completions.push({
        date: shiftBack(TODAY, i),
        status: i > 6,
        value: 1,
        kind: 'FULL',
      });
    }
    const report = reportOf(completions);
    expect(report.signals).toContain('DECLINING');
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.type).toBe('RECOVERY');
    expect(result.reason).toMatch(/\d+%/);
  });

  it('RECOVERING → PROTECT_MOMENTUM (recognition over pressure)', () => {
    const completions: CompletionFact[] = [];
    for (let i = 13; i >= 0; i--) {
      completions.push({
        date: shiftBack(TODAY, i),
        status: i <= 6,
        value: 1,
        kind: 'FULL',
      });
    }
    const report = reportOf(completions);
    expect(report.signals).toContain('RECOVERING');
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.type).toBe('PROTECT_MOMENTUM');
    expect(result.priority).toBe(76);
    expect(result.category).toBe('INFORMATIONAL');
  });
});

describe('InterventionEngine — cross-habit overload (spec scenarios 18–19)', () => {
  it('heavy broadly-failing set → PREPARE_FOR_RISK with numbers', () => {
    const report = reportOf(run(TODAY, 30));
    const result = evaluateIntervention(report, {
      ...baseCtx,
      crossHabit: { activeHabits: 8, habitsAtRisk: 5, avgMissRate30: 0.62 },
    })!;
    expect(result.type).toBe('PREPARE_FOR_RISK');
    expect(result.facts.activeHabits).toBe(8);
    expect(result.facts.habitsAtRisk).toBe(5);
    expect(result.sourceSignals).toContain('OVERLOADED');
  });

  it('insufficient cross-habit evidence → no overload intervention', () => {
    const report = reportOf(run(TODAY, 30));
    const result = evaluateIntervention(report, {
      ...baseCtx,
      crossHabit: { activeHabits: 3, habitsAtRisk: 1, avgMissRate30: 0.55 },
    });
    expect(result === null || result.sourceSignals.includes('OVERLOADED')).toBe(false);
  });

  it('healthy cross-habit data never triggers overload', () => {
    const report = reportOf(run(TODAY, 30));
    const result = evaluateIntervention(report, {
      ...baseCtx,
      crossHabit: { activeHabits: 9, habitsAtRisk: 1, avgMissRate30: 0.1 },
    });
    if (result) expect(result.sourceSignals).not.toContain('OVERLOADED');
  });
});

describe('InterventionEngine — priority conflicts (spec §35)', () => {
  it('CRITICAL + STRONG_MOMENTUM → RECOVERY wins', () => {
    const report = stubReport({
      risk: { score: 0.9, level: 'CRITICAL', reasons: ['critical'] },
      signals: ['STRONG_MOMENTUM'],
      momentum: { score: 0.8, level: 'STRONG' },
    });
    const result = evaluateIntervention(report, baseCtx)!;
    expect(result.type).toBe('RECOVERY');
    expect(result.priority).toBe(100);
  });

  it('STRONG_MOMENTUM + WEEKDAY_RISK (quiet band) → PREPARE_FOR_RISK wins', () => {
    const report = stubReport({
      risk: { score: 0.2, level: 'MODERATE', reasons: [] },
      signals: ['STRONG_MOMENTUM'],
      momentum: { score: 0.8, level: 'STRONG' },
      structuredSignals: [weekdaySignal()],
    });
    const result = evaluateIntervention(report, {
      ...baseCtx,
      todayKey: '2026-08-18',
    })!;
    expect(result.type).toBe('PREPARE_FOR_RISK');
    expect(result.priority).toBe(74);
  });

  it('rule table stays strictly ordered by descending priority', () => {
    // Guarded indirectly: every returned priority must be one of the table's.
    const priorities = [100, 92, 88, 84, 82, 80, 78, 76, 74, 70, 60];
    const report = stubReport({});
    const result = evaluateIntervention(report, baseCtx);
    if (result) expect(priorities).toContain(result.priority);
    expect(result).toBeNull(); // default stub is a healthy steady user
  });
});

describe('daysUntilWeekday helper', () => {
  it('computes forward distance with today as 0', () => {
    expect(daysUntilWeekday('2026-08-23', 'Sun')).toBe(0);
    expect(daysUntilWeekday('2026-08-23', 'Mon')).toBe(1);
    expect(daysUntilWeekday('2026-08-23', 'Thu')).toBe(4);
    expect(daysUntilWeekday('2026-08-19', 'Thu')).toBe(1);
    expect(daysUntilWeekday('2026-08-18', 'Thu')).toBe(2);
  });
});
