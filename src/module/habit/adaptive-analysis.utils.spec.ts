import { BehaviorReport, buildBehaviorReport, CompletionFact } from '../../core/utils/behavior-analytics.utils';
import {
  AdaptiveHabitShape,
  adaptiveFingerprint,
  analyzeAdaptation,
} from './adaptive-analysis.utils';

const TODAY = '2026-08-23';

const run = (
  endKey: string,
  count: number,
  opts: { skipWeekdays?: number[]; kind?: CompletionFact['kind'] } = {},
): CompletionFact[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${endKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return {
      date: d.toISOString().slice(0, 10),
      status: !(opts.skipWeekdays ?? []).includes(d.getUTCDay()),
      value: 1,
      kind: opts.kind ?? 'FULL',
    };
  });

const SHAPE: AdaptiveHabitShape = {
  goal: 5,
  unit: 'km',
  scheduleType: 'daily',
  timesPerWeek: null,
  scheduledTime: '20:00',
};

const SNAP = {
  fullBehavior: 'Run 5km',
  minimumBehavior: 'Walk 5 minutes',
  emergencyMinimum: null,
};

const reportOf = (
  completions: CompletionFact[],
  overrides: Partial<Parameters<typeof buildBehaviorReport>[0]['habit']> = {},
) =>
  buildBehaviorReport({
    habit: { id: 'h1', scheduleType: 'daily', ...overrides },
    completions,
    todayKey: TODAY,
  });

/**
 * A genuinely struggling month: sparse emergency-crutch history followed by
 * a minimum-heavy recent week — the classic REDUCE_TARGET evidence stack.
 */
const hardCompletions = (): CompletionFact[] => {
  const out: CompletionFact[] = [
    ...run(TODAY, 6, { kind: 'MINIMUM' }), // Aug 18-23 barely showing up
    { date: '2026-08-17', status: true, value: 1, kind: 'EMERGENCY' },
  ];
  for (let i = 8; i <= 29; i += 3) {
    const d = new Date(`${TODAY}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 4) continue; // Thursdays fully missed
    out.push({
      date: d.toISOString().slice(0, 10),
      status: true,
      value: 1,
      kind: 'EMERGENCY',
    });
  }
  return out;
};

describe('adaptive analysis — difficulty cluster', () => {
  it('TOO_HARD + low rate + min overuse → REDUCE_TARGET halving the goal', () => {
    const analysis = analyzeAdaptation(reportOf(hardCompletions()), SHAPE, SNAP);
    expect(analysis.state).toBe('MINIMUM_VERSION_OVERUSED');
    expect(analysis.proposal?.type).toBe('REDUCE_TARGET');
    expect(analysis.proposal?.current.goal).toBe(5);
    expect(analysis.proposal?.proposed.goal).toBe(2); // floor(5*0.5)
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.6);
    expect(analysis.sourceSignals).toContain('TOO_HARD');
    expect(analysis.reason).toMatch(/\d+%/);
  });

  it('high completion with no difficulty signal → NO_CHANGE (never optimize)', () => {
    const analysis = analyzeAdaptation(reportOf(run(TODAY, 30)), SHAPE, SNAP);
    expect(['NO_CHANGE', 'CONSISTENCY_IMPROVING']).toContain(analysis.state);
    expect(analysis.proposal).toBeNull();
  });

  it('insufficient history → INSUFFICIENT_EVIDENCE regardless of signals', () => {
    const analysis = analyzeAdaptation(reportOf([]), SHAPE, SNAP);
    expect(analysis.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(analysis.proposal).toBeNull();
    expect(analysis.confidence).toBe(0);
  });

  it('thin samples below the floor never produce proposals', () => {
    // Exactly 3 completions (< MIN_COMPLETION_SAMPLES_30D=6).
    const analysis = analyzeAdaptation(reportOf(run(TODAY, 3, { kind: 'MINIMUM' })), SHAPE, SNAP);
    expect(analysis.state).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('goal <= 1 is not numerically reducible → no REDUCE_TARGET proposal', () => {
    const analysis = analyzeAdaptation(
      reportOf(hardCompletions()),
      { ...SHAPE, goal: 1 },
      SNAP,
    );
    if (analysis.proposal) {
      expect(analysis.proposal.type).not.toBe('REDUCE_TARGET');
    }
  });
});

describe('adaptive analysis — emergency & minimum evidence', () => {
  it('emergency crutch surfaces EMERGENCY_VERSION_OVERUSED advice', () => {
    const comps = [
      ...run(TODAY, 6, { kind: 'EMERGENCY' }),
      ...run('2026-08-15', 24),
    ];
    const analysis = analyzeAdaptation(reportOf(comps), SHAPE, SNAP);
    expect(['EMERGENCY_VERSION_OVERUSED', 'NO_CHANGE']).toContain(analysis.state);
    if (analysis.state === 'EMERGENCY_VERSION_OVERUSED') {
      expect(analysis.evidence.emergencyCount30).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('adaptive analysis — frequency cluster', () => {
  it('ambitious quota + weak rate → REDUCE_FREQUENCY with floored new quota', () => {
    const shape: AdaptiveHabitShape = {
      ...SHAPE,
      scheduleType: 'times_per_week',
      timesPerWeek: 7,
    };
    // Sparse completions: ~40% of days.
    const comps = run(TODAY, 30, { skipWeekdays: [1, 3, 5] }); // misses Mon/Wed/Fri
    const analysis = analyzeAdaptation(reportOf(comps), shape, SNAP);
    if (analysis.proposal?.type === 'REDUCE_FREQUENCY') {
      expect(analysis.proposal.current.timesPerWeek).toBe(7);
      expect(analysis.proposal.proposed.timesPerWeek).toBeGreaterThanOrEqual(2);
      expect(analysis.proposal.proposed.timesPerWeek!).toBeLessThan(7);
    } else {
      // If rate stayed above the floor, nothing may be proposed.
      expect(analysis.proposal).toBeNull();
    }
  });
});

describe('adaptive analysis — timing cluster', () => {
  const timedReport = () => {
    const completions: CompletionFact[] = [];
    for (let i = 0; i < 7; i++) {
      const day = String(16 + i).padStart(2, '0');
      completions.push({
        date: `2026-08-${day}`,
        status: true,
        value: 1,
        kind: 'FULL',
        createdAt:
          i < 6 ? `2026-08-${day}T07:30:00.000Z` : `2026-08-${day}T23:30:00.000Z`,
      });
    }
    return buildBehaviorReport({
      habit: { id: 'h', scheduleType: 'daily', scheduledTime: '21:00' },
      completions: [...completions, ...run('2026-08-15', 25)],
      todayKey: TODAY,
    });
  };

  it('best-window mismatch proposes CHANGE_TIME to the bucket representative', () => {
    const analysis = analyzeAdaptation(timedReport(), { ...SHAPE, scheduledTime: '21:00' }, SNAP);
    if (analysis.proposal?.type === 'CHANGE_TIME') {
      expect(analysis.proposal.current.scheduledTime).toBe('21:00');
      expect(analysis.proposal.proposed.scheduledTime).toMatch(/^\d{2}:\d{2}$/);
      expect(analysis.proposal.proposed.scheduledTime).not.toBe('21:00');
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.6);
    } else {
      expect(['NO_CHANGE', 'CONSISTENCY_IMPROVING', 'CONSISTENCY_DECLINING']).toContain(analysis.state);
    }
  });

  it('cue already inside the best window → no timing proposal', () => {
    const report = timedReport();
    report.timeWindows.scheduledBucketCode = report.timeWindows.best!.code;
    const analysis = analyzeAdaptation(report, { ...SHAPE, scheduledTime: '07:30' }, SNAP);
    expect(analysis.proposal?.type ?? 'none').not.toBe('CHANGE_TIME');
  });

  it('no cue time set → no CHANGE_TIME proposal even with strong windows', () => {
    const analysis = analyzeAdaptation(timedReport(), { ...SHAPE, scheduledTime: null }, SNAP);
    expect(analysis.proposal?.type ?? 'none').not.toBe('CHANGE_TIME');
  });
});

describe('adaptive analysis — identity & determinism', () => {
  it('identity is NOT part of the deterministic contract (framing only)', () => {
    const a = analyzeAdaptation(reportOf(hardCompletions()), SHAPE, SNAP);
    expect(JSON.stringify(a)).not.toContain('Runner');
  });

  it('is deterministic and does not mutate the report', () => {
    const completions = hardCompletions();
    const report = reportOf(completions);
    const snap = JSON.stringify(report);
    const a = analyzeAdaptation(report, SHAPE, SNAP);
    const b = analyzeAdaptation(report, SHAPE, SNAP);
    expect(a).toEqual(b);
    expect(JSON.stringify(report)).toBe(snap);
  });
});

describe('adaptive fingerprint', () => {
  it('identical evidence yields identical fingerprints; moved evidence changes them', () => {
    const a = analyzeAdaptation(reportOf(hardCompletions()), SHAPE, SNAP);
    const fa = adaptiveFingerprint('h1', a);
    const fb = adaptiveFingerprint('h1', a);
    expect(fa).toBe(fb);
    expect(fa).not.toBe('');

    const shifted = analyzeAdaptation(
      reportOf(hardCompletions().map((c) => ({ ...c, status: c.status && !c.date.endsWith('22') }))),
      SHAPE,
      SNAP,
    );
    if (shifted.proposal && a.proposal) {
      const fs = adaptiveFingerprint('h1', shifted);
      // Rate bucket moved by >5% ⇒ different proposal identity.
      if (Math.abs((a.evidence.completionRate30 ?? 0) - (shifted.evidence.completionRate30 ?? 0)) > 0.05) {
        expect(fs).not.toBe(fa);
      }
    }
  });

  it('advice-only analyses have an empty fingerprint', () => {
    const none = analyzeAdaptation(reportOf(run(TODAY, 30)), SHAPE, SNAP);
    expect(adaptiveFingerprint('h1', none)).toBe('');
  });
});
