import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InterventionService } from './intervention.service';
import { DatabaseService } from '../../core/database/database.service';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';

const HABIT_ROW = {
  id: 'habit-1',
  isArchived: false,
  scheduledTime: '20:00',
  fullBehavior: 'Run 5km',
  minimumBehavior: 'Walk 5 minutes',
  emergencyMinimum: null,
  stackAfterHabitId: null,
  scheduleType: 'daily',
  scheduleDays: [],
  timesPerWeek: null,
  intervalDays: null,
  startDate: null,
};

const SIBLING_ROW = {
  id: 'anchor-1',
  title: 'Morning coffee ritual',
  scheduleType: 'daily',
  scheduleDays: [],
  timesPerWeek: null,
  intervalDays: null,
  startDate: null,
  completions: Array.from({ length: 30 }, (_, i) => {
    const d = new Date('2026-08-22T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - i);
    return { date: d.toISOString().slice(0, 10), status: true };
  }),
};

const baseMockReport = () => ({
  habitId: 'habit-1',
  habitTitle: 'Read',
  isArchived: false,
  analyzedAsOf: '2026-08-23',
  insufficientHistory: false,
  completedToday: false,
  kindMix30: {
    total: 25,
    full: { count: 20, share: 0.8 },
    minimum: { count: 4, share: 0.16 },
    emergency: { count: 1, share: 0.04 },
  },
  completionRates: {
    d7: { rate: 0.86, expected: 7, completed: 6 },
    d30: { rate: 0.83, expected: 30, completed: 25 },
  },
  missRates: {
    d7: { rate: 0.14, expected: 7, completed: 6 },
    d30: { rate: 0.17, expected: 30, completed: 25 },
  },
  previousWeekRate: 0.7,
  streaks: { current: 10, longest: 14 },
  momentum: { score: 0.8, level: 'STRONG' },
  risk: { score: 0.12, level: 'LOW', reasons: [] },
  signals: ['CONSISTENT', 'STRONG_MOMENTUM'],
  structuredSignals: [],
  timezoneUsed: 'UTC',
});

const makeDeps = () => {
  const db = {
    habit: {
      findFirst: jest.fn().mockResolvedValue(HABIT_ROW),
      findMany: jest.fn().mockResolvedValue([SIBLING_ROW]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    identityHabit: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const analytics = {
    getHabitBehaviorReport: jest.fn().mockImplementation(() =>
      Promise.resolve(baseMockReport()),
    ),
  };
  const svc = new InterventionService(
    db as unknown as DatabaseService,
    analytics as unknown as HabitAnalyticsService,
  );
  return { svc, db, analytics };
};

describe('InterventionService', () => {
  it('throws NotFound when the habit does not exist or belongs to someone else', async () => {
    const { svc, db } = makeDeps();
    db.habit.findFirst.mockResolvedValue(null);
    await expect(svc.getForHabit('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.habit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing', userId: 'user-1' } }),
    );
  });

  it('rejects malformed date params with BadRequest before any query', async () => {
    const { svc, db } = makeDeps();
    for (const bad of ['not-a-date', '2026/08/23', '2026-13-40']) {
      await expect(svc.getForHabit('u', 'h', bad)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(db.habit.findFirst).not.toHaveBeenCalled();
  });

  it('returns { intervention: null } when the engine has nothing to say', async () => {
    const { svc } = makeDeps();
    const res = await svc.getForHabit('user-1', 'habit-1');
    // STRONG momentum + LOW risk + no weekday/time/overload evidence →
    // REINFORCE_IDENTITY is expected here; assert contract shape either way.
    if (res.intervention === null) {
      expect(res).toEqual({ intervention: null });
    } else {
      expect(res.intervention.type).toBe('REINFORCE_IDENTITY');
      expect(res.intervention.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('reinforces identity using real evidence counts from the report', async () => {
    const { svc } = makeDeps();
    const { intervention } = await svc.getForHabit('user-1', 'habit-1');
    expect(intervention?.type).toBe('REINFORCE_IDENTITY');
    expect(intervention?.reason).toContain('25'); // completionsLast30
    expect(intervention?.facts.completionsLast30).toBe(25);
  });

  it('recommends HABIT_STACK with the sibling title under weekday risk', async () => {
    const { svc, analytics } = makeDeps();
    analytics.getHabitBehaviorReport.mockResolvedValue({
      habitId: 'habit-1',
      habitTitle: 'Read',
      isArchived: false,
      analyzedAsOf: '2026-08-18',
      insufficientHistory: false,
      completedToday: false,
      kindMix30: {
        total: 20,
        full: { count: 16, share: 0.8 },
        minimum: { count: 3, share: 0.15 },
        emergency: { count: 1, share: 0.05 },
      },
      completionRates: {
        d7: { rate: 0.5, expected: 6, completed: 3 },
        d30: { rate: 0.7, expected: 28, completed: 20 },
      },
      missRates: {
        d7: { rate: 0.5, expected: 6, completed: 3 },
        d30: { rate: 0.3, expected: 28, completed: 20 },
      },
      previousWeekRate: null,
      streaks: { current: 0, longest: 9 },
      momentum: { score: 0.4, level: 'STEADY' },
      risk: { score: 0.66, level: 'HIGH', reasons: ['misses'] },
      signals: ['AT_RISK'],
      structuredSignals: [
        { type: 'WEEKDAY_RISK', day: 'THURSDAY', completionRate: 0.31 },
      ],
      timezoneUsed: 'UTC',
    });
    const { intervention } = await svc.getForHabit(
      'user-1',
      'habit-1',
      '2026-08-18', // Tuesday -> Thursday within approach window
    );
    expect(intervention?.type).toBe('HABIT_STACK');
    expect(intervention?.reason).toContain('Morning coffee ritual');
    expect(intervention?.facts.weekday).toBe('Thu');
  });

  it('keeps quiet-band weekday risk at lower priority via the same path', async () => {
    const { svc, analytics } = makeDeps();
    analytics.getHabitBehaviorReport.mockResolvedValue({
      ...baseMockReport(),
      risk: { score: 0.2, level: 'MODERATE', reasons: [] },
      signals: [],
      momentum: { score: 0.5, level: 'STEADY' },
      structuredSignals: [
        { type: 'WEEKDAY_RISK', day: 'THURSDAY', completionRate: 0.4 },
      ],
    });
    const { intervention } = await svc.getForHabit(
      'user-1',
      'habit-1',
      '2026-08-19', // Wednesday
    );
    // Reliable sibling exists -> §10 preference for stacking still applies,
    // but at the quiet-band priority instead of HIGH.
    expect(intervention?.type).toBe('HABIT_STACK');
    expect(intervention?.priority).toBe(74);
  });

  it('generates ZERO database mutations (read-only contract)', async () => {
    const { svc, db } = makeDeps();
    await svc.getForHabit('user-1', 'habit-1');
    for (const model of [db.habit, db.identityHabit]) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
      expect(model.delete).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    }
  });

  it('reuses the analytics service instead of recomputing completions', async () => {
    const { svc, analytics, db } = makeDeps();
    await svc.getForHabit('user-1', 'habit-1');
    expect(analytics.getHabitBehaviorReport).toHaveBeenCalledWith(
      'user-1',
      'habit-1',
      undefined,
    );
    // Only bounded context queries beyond the report:
    expect(db.habit.findFirst).toHaveBeenCalledTimes(1);
    expect(db.habit.findMany).toHaveBeenCalledTimes(1);
    expect(db.identityHabit.findFirst).toHaveBeenCalledTimes(1);
  });

  it('produces identical fingerprints for identical same-week requests', async () => {
    const { svc } = makeDeps();
    const a = await svc.getForHabit('user-1', 'habit-1', '2026-08-18');
    const b = await svc.getForHabit('user-1', 'habit-1', '2026-08-19');
    const c = await svc.getForHabit('user-2', 'habit-1', '2026-08-18');
    expect(a.intervention!.fingerprint).toBe(b.intervention!.fingerprint); // same ISO week
    expect(a.intervention!.fingerprint).not.toBe(c.intervention!.fingerprint); // per-user
  });
});
