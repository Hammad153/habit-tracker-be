import { NotFoundException } from '@nestjs/common';
import { AdaptiveService } from './adaptive.service';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';
import { HabitService } from './habit.service';
import { DatabaseService } from '../../core/database/database.service';
import type { AiProvider } from '../../core/ai/ai-provider.interface';

const TODAY = '2026-08-23'; // frozen clock date

const healthyReport = () => ({
  completionRates: {
    d7: { rate: 0.9, expected: 7, completed: 6 },
    d30: { rate: 0.86, expected: 30, completed: 26 },
  },
  missRates: { d7: { rate: 0.1, expected: 7 }, d30: { rate: 0.14, expected: 30 } },
  streaks: { current: 12, longest: 20 },
  risk: { score: 0.1, level: 'LOW' },
});

const makeDeps = () => {
  const db = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ timezone: null, coachEnabled: true, aiCoachEnabled: true, coachTone: 'BALANCED', coachFrequency: 'STANDARD', weeklyReviewEnabled: true }),
    },
    habit: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'h1', title: 'Run', goal: 5, unit: 'km', scheduleType: 'daily',
        timesPerWeek: null, scheduledTime: '20:00', scheduleDays: [],
        intervalDays: null, startDate: null,
        fullBehavior: 'Run 5km', minimumBehavior: 'Walk', emergencyMinimum: null,
        completions: [],
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    identityHabit: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    habitAdjustmentProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockImplementation(({ data }) => Promise.resolve({ count: 1, data })),
      deleteMany: jest.fn(),
    },
  };
  const analytics = {
    getHabitBehaviorReport: jest.fn().mockResolvedValue(healthyReport()),
  };
  const habitSvc = { updateHabit: jest.fn().mockResolvedValue({ id: 'h1' }) };
  const aiProvider = { name: 'nvidia', model: null, generateRawText: jest.fn(), generateCoachResponse: jest.fn() };
  const svc = new AdaptiveService(
    db as unknown as DatabaseService,
    analytics as unknown as HabitAnalyticsService,
    habitSvc as unknown as HabitService,
    aiProvider as unknown as AiProvider,
  );
  return { svc, db, analytics, habitSvc, aiProvider };
};

/** An ACCEPTED proposal awaiting evaluation. */
const acceptedRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  userId: 'owner',
  habitId: 'h1',
  status: 'ACCEPTED',
  outcome: null,
  type: 'REDUCE_TARGET',
  state: 'TOO_HARD',
  confidence: 0.75,
  reason: '',
  sourceSignals: ['TOO_HARD'],
  evidence: {},
  currentSnapshot: { goal: 5 },
  proposedSnapshot: { goal: 2 },
  aiHeadline: null,
  aiMessage: null,
  baselineCompletionRate: 0.4,
  baselineMissRate: 0.6,
  baselineStreak: 2,
  baselineRiskLevel: 'HIGH',
  baselineRiskScore: 0.65,
  acceptedAt: new Date('2026-08-01T10:00:00Z'),
  evaluationStartDate: '2026-08-01',
  evaluationEndDate: '2026-08-14',
  createdAt: new Date('2026-08-01T10:00:00Z'),
  ...over,
});

describe('acceptance — immutable baseline capture', () => {
  it('accept writes baseline + evaluation window exactly once, pre-change values', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst.mockResolvedValue({
      id: 'p1', userId: 'owner', habitId: 'h1', status: 'PENDING',
      fingerprint: 'f', type: 'REDUCE_TARGET', state: 'TOO_HARD',
      confidence: 0.8, reason: '', sourceSignals: [], evidence: {},
      currentSnapshot: { goal: 5 }, proposedSnapshot: { goal: 2 },
      aiHeadline: null, aiMessage: null, createdAt: new Date(),
    });
    await svc.acceptProposal('owner', 'h1', 'p1');
    const arg = db.habitAdjustmentProposal.update.mock.calls[0][0];
    expect(arg.data.status).toBe('ACCEPTED');
    expect(arg.data.baselineCompletionRate).toBe(0.86); // BEFORE mutation
    expect(arg.data.baselineMissRate).toBeCloseTo(0.14);
    expect(arg.data.evaluationStartDate).toBe(TODAY);
    expect(arg.data.evaluationEndDate).toBe('2026-09-05'); // Day 0..13
    expect(arg.data.outcome).toBe('PENDING');
    // Baseline reflects the PRE-change report (0.86, not something post-edit).
  });

  it('double acceptance is impossible — second sees no PENDING row', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst
      .mockResolvedValueOnce({ id: 'p1', userId: 'owner', habitId: 'h1', status: 'PENDING', fingerprint: 'f', type: 'REDUCE_TARGET', state: 'S', confidence: 0.9, reason: '', sourceSignals: [], evidence: {}, currentSnapshot: {}, proposedSnapshot: { goal: 2 }, aiHeadline: null, aiMessage: null, createdAt: new Date() })
      .mockResolvedValue(null); // now ACCEPTED → findOwnedPending finds nothing
    await svc.acceptProposal('owner', 'h1', 'p1');
    await expect(svc.acceptProposal('owner', 'h1', 'p1')).rejects.toThrow(NotFoundException);
    expect(db.habitAdjustmentProposal.update).toHaveBeenCalledTimes(1);
  });
});

describe('outcome evaluation — classification & idempotency', () => {
  const dailyShape = { scheduleType: 'daily', scheduleDays: [], timesPerWeek: null, intervalDays: null, startDate: null };

  it('not-yet-due proposals stay untouched (window still open)', async () => {
    const { svc, db } = makeDeps();
    // Service filters due-ness via evaluationEndDate lte today; a row dated
    // in the future would never reach the evaluator — simulate by ensuring
    // the query filter is present and nothing comes back:
    db.habitAdjustmentProposal.findMany.mockImplementation((args) => {
      expect(args.where.evaluationEndDate).toEqual({ lte: TODAY });
      return Promise.resolve([]);
    });
    await svc.evaluateDueOutcomes('owner', 'h1');
    expect(db.habitAdjustmentProposal.updateMany).not.toHaveBeenCalled();
  });

  it('fewer than 3 scheduled opportunities → INSUFFICIENT_DATA with real count', async () => {
    const { svc, db } = makeDeps();
    // times_per_week=1 → only ~2 opportunities inside the 14-day window.
    db.habit.findFirst.mockResolvedValue({
      ...dailyShape, scheduleType: 'times_per_week', timesPerWeek: 1,
      completions: [{ date: '2026-08-03', status: true }],
    });
    db.habitAdjustmentProposal.findMany.mockResolvedValue([acceptedRow()]);
    await svc.evaluateDueOutcomes('owner', 'h1');
    const arg = db.habitAdjustmentProposal.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'p1', outcome: null }); // guarded finalize
    expect(arg.data.outcome).toBe('INSUFFICIENT_DATA');
    expect(arg.data.scheduledOpportunities).toBeLessThan(3);
    expect(arg.data.postCompletionRate).toBeUndefined();
  });

  it.each([
    ['IMPROVED', 0.9],
    ['UNCHANGED', 0.45],
    ['WORSENED', 0.1],
  ])('daily habit fully done at %s path → %s', async (expected, rate) => {
    const { svc, db, analytics } = makeDeps();
    // Every day in the window is a completed opportunity at `rate`:
    const completions: Array<{ date: string; status: boolean }> = [];
    for (let k = 0; k < 14; k++) {
      const d = new Date(`${'2026-08-01'}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + k);
      const key = d.toISOString().slice(0, 10);
      completions.push({ date: key, status: true });
    }
    const doneCount = Math.round(14 * (rate as number));
    completions.forEach((c, i) => { c.status = i < doneCount; });
    db.habit.findFirst.mockResolvedValue({ ...dailyShape, completions });
    db.habitAdjustmentProposal.findMany.mockResolvedValue([acceptedRow()]);
    analytics.getHabitBehaviorReport.mockResolvedValue(healthyReport());
    await svc.evaluateDueOutcomes('owner', 'h1');
    const data = db.habitAdjustmentProposal.updateMany.mock.calls[0][0].data;
    expect(data.outcome).toBe(expected);
    if (expected !== 'INSUFFICIENT_DATA') {
      expect(data.postCompletionRate).toBeCloseTo(rate as number, 1);
      // Baselines are never part of the finalize payload:
      expect(data.baselineCompletionRate).toBeUndefined();
    }
  });

  it('risk-band improvement alone classifies IMPROVED; worsening alone WORSENED', async () => {
    for (const [postLevel, expected] of [
      ['LOW', 'IMPROVED'],
      ['CRITICAL', 'WORSENED'],
    ] as const) {
      const { svc, db, analytics } = makeDeps();
      const completions = Array.from({ length: 14 }, (_, k) => {
        const d = new Date('2026-08-01T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + k);
        return { date: d.toISOString().slice(0, 10), status: true };
      });
      db.habit.findFirst.mockResolvedValue({ ...dailyShape, completions });
      db.habitAdjustmentProposal.findMany.mockResolvedValue([acceptedRow()]);
      analytics.getHabitBehaviorReport.mockResolvedValue({
        ...healthyReport(),
        risk: { score: postLevel === 'LOW' ? 0.05 : 0.9, level: postLevel },
      });
      await svc.evaluateDueOutcomes('owner', 'h1');
      expect(db.habitAdjustmentProposal.updateMany.mock.calls[0][0].data.outcome).toBe(expected);
    }
  });

  it('duplicate evaluation cannot overwrite or conflict (guarded by outcome:null)', async () => {
    const { svc, db } = makeDeps();
    const completions = Array.from({ length: 14 }, (_, k) => {
      const d = new Date('2026-08-01T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + k);
      return { date: d.toISOString().slice(0, 10), status: true };
    });
    db.habit.findFirst.mockResolvedValue({ ...dailyShape, completions });
    db.habitAdjustmentProposal.findMany.mockResolvedValue([
      acceptedRow({ outcome: null }),
      acceptedRow({ outcome: null }), // concurrent duplicate in the same batch
    ]);
    await svc.evaluateDueOutcomes('owner', 'h1');
    // Both attempts target the SAME guarded predicate:
    expect(db.habitAdjustmentProposal.updateMany).toHaveBeenCalledTimes(2);
    for (const call of db.habitAdjustmentProposal.updateMany.mock.calls) {
      expect(call[0].where).toEqual({ id: 'p1', outcome: null });
    }
  });

  it('legacy rows without evaluation windows are never evaluated', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findMany.mockResolvedValue([]); // filter excludes them
    await svc.evaluateDueOutcomes('owner', 'h1');
    expect(db.habit.findFirst).not.toHaveBeenCalled();
    expect(db.habitAdjustmentProposal.updateMany).not.toHaveBeenCalled();
  });
});

describe('adaptation outcomes endpoint — aggregation & ownership', () => {
  it('foreign habit → NotFound before any aggregation', async () => {
    const { svc, db } = makeDeps();
    db.habit.findFirst.mockResolvedValue(null);
    await expect(svc.getAdaptationOutcomes('intruder', 'h1')).rejects.toThrow(NotFoundException);
  });

  it('aggregates counts, delta average and latest outcome; exposes no ids', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findMany.mockResolvedValue([
      { status: 'ACCEPTED', outcome: 'IMPROVED', type: 'REDUCE_TARGET', baselineCompletionRate: 0.4, postCompletionRate: 0.7, acceptedAt: new Date('2026-08-02') },
      { status: 'ACCEPTED', outcome: 'WORSENED', type: 'CHANGE_TIME', baselineCompletionRate: 0.6, postCompletionRate: 0.3, acceptedAt: new Date('2026-08-03') },
      { status: 'ACCEPTED', outcome: null, type: 'REDUCE_FREQUENCY', baselineCompletionRate: null, postCompletionRate: null, acceptedAt: new Date('2026-08-04') },
      { status: 'REJECTED', outcome: null, type: 'CHANGE_TIME', baselineCompletionRate: null, postCompletionRate: null, acceptedAt: null },
    ]);
    const res = await svc.getAdaptationOutcomes('owner', 'h1');
    expect(res.accepted).toBe(3);
    expect(res.rejected).toBe(1);
    expect(res.completedEvaluations).toBe(2);
    expect(res.improved).toBe(1);
    expect(res.worsened).toBe(1);
    expect(res.averageCompletionDelta).toBeCloseTo((0.3 + -0.3) / 2, 5);
    expect(res.latestOutcome).toBe('WORSENED'); // most recent accepted w/ outcome
    expect(JSON.stringify(res)).not.toContain('"id"');
    expect(res.recent.length).toBe(2);
  });
});
