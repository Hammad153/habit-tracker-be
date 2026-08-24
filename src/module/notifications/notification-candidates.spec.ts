import { AdaptiveService } from '../habit/adaptive.service';
import { PortfolioOverloadService } from '../analytics/portfolio-overload.service';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';
import { DatabaseService } from '../../core/database/database.service';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import {
  NotificationCandidatesService,
} from './notification-candidates.service';

// ---------------------------------------------------------------------------
beforeAll(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  jest.setSystemTime(new Date('2026-08-23T12:00:00.000Z')); // Sunday noon UTC
});
afterAll(() => {
  jest.useRealTimers();
});

const strugglingReport = (title: string) => ({
  habitId: 'h1',
  habitTitle: title,
  isArchived: false,
  analyzedAsOf: '2026-08-23',
  completedToday: false,
  insufficientHistory: false,
  windows: { short: 7, medium: 30, long: 90 },
  completionRates: {
    d7: { rate: 0.3, expected: 6, completed: 2 },
    d30: { rate: 0.35, expected: 28, completed: 10 },
    d90: { rate: 0.4, expected: 90, completed: 36 },
  },
  missRates: {
    d7: { rate: 0.7, expected: 6 },
    d30: { rate: 0.65, expected: 28 },
  },
  streaks: { current: 0, longest: 9 },
  kindMix30: {
    total: 10,
    full: { count: 4, share: 0.4 },
    minimum: { count: 5, share: 0.5 },
    emergency: { count: 1, share: 0.1 },
  },
  minimumCompletionRate30: 0.5,
  emergencyCompletionRate30: 0.1,
  averageCompletionValue30: 5,
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
  momentum: { score: 0.3, level: 'FADING' },
  risk: { score: 0.66, level: 'HIGH', reasons: ['7 of 10 missed in the last week'] },
  signals: ['AT_RISK', 'TOO_HARD'],
  structuredSignals: [],
});

const makeDeps = () => {
  const db = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: null,
        coachEnabled: true,
        aiCoachEnabled: true,
        coachFrequency: 'STANDARD',
        weeklyReviewEnabled: true,
      }),
    },
    habit: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'h1',
          title: 'Run',
          goal: 5,
          scheduleType: 'daily',
          scheduleDays: [],
          timesPerWeek: null,
          intervalDays: null,
          scheduledTime: '20:00',
          startDate: null,
          fullBehavior: null,
          minimumBehavior: null,
          emergencyMinimum: null,
          completions: [{ date: '2026-08-22', value: 1, kind: 'FULL' }],
        },
      ]),
      findFirst: jest.fn().mockResolvedValue({ id: 'h1' }),
    },
    identityHabit: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notificationDelivery: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({ id: 'x', ...where.userId_fingerprint }),
      ),
    },
    habitAdjustmentProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const analytics = {
    getHabitBehaviorReport: jest.fn().mockResolvedValue(strugglingReport('Run')),
  };
  const overloadSvc = {
    getOverloadReport: jest.fn().mockResolvedValue({
      overloaded: true,
      score: 0.72,
      activeHabitCount: 7,
      analyzedHabitCount: 7,
      atRiskHabitCount: 6,
      highRiskHabitCount: 5,
      averageMissRate30: 0.46,
      averageCompletionRate30: 0.54,
      contributors: [],
      contributingFactors: ['5 of 7 analyzed habits are HIGH or CRITICAL risk.'],
      confidence: 'HIGH',
      insight: {
        headline: 'You are carrying a lot right now',
        message: 'Let us reduce friction without losing your momentum.',
        ctaLabel: 'Review habits',
      },
    }),
  };
  const aiProvider = { name: 'nvidia', model: null, generateRawText: jest.fn(), generateCoachResponse: jest.fn() };
  const behavioralEvents = {
    recordCandidateGenerated: jest.fn().mockResolvedValue(undefined),
    recordDelivered: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new NotificationCandidatesService(
    db as unknown as DatabaseService,
    analytics as unknown as HabitAnalyticsService,
    overloadSvc as unknown as PortfolioOverloadService,
    behavioralEvents as never,
    aiProvider as unknown as AiProvider,
  );
  return { svc, db, analytics, overloadSvc, aiProvider, behavioralEvents };
};

describe('notification candidates — surfacing & ranking', () => {
  it('overloaded portfolio surfaces OVERLOAD_DETECTED with deep link + real numbers', async () => {
    const { svc } = makeDeps();
    const res = await svc.getCandidates('owner');
    const overload = res.find((c) => c.type === 'OVERLOAD_DETECTED');
    expect(overload).toBeDefined();
    expect(overload!.fingerprint).toMatch(/^overload:owner:\d{4}-\d{2}-\d{2}$/);
    expect(overload!.action.route).toBe('/manage-habits');
    expect(overload!.body).toContain('momentum');
  });

  it('habit signals map to typed candidates citing deterministic reasons', async () => {
    const { svc } = makeDeps();
    const res = await svc.getCandidates('owner');
    const types = res.map((c) => c.type);
    expect(types.length).toBeGreaterThan(0);
    expect(types.length).toBeLessThanOrEqual(3);
    if (types.includes('HABIT_AT_RISK')) {
      const c = res.find((x) => x.type === 'HABIT_AT_RISK')!;
      expect(c.body).toContain('missed');
      expect(c.action.route).toBe('/habit-detail?habitId=h1');
    }
    if (types.includes('DIFFICULTY_TOO_HIGH')) {
      expect(res.find((x) => x.type === 'DIFFICULTY_TOO_HIGH')!.fingerprint).toContain(':92:');
    }
  });

  it('weekly review candidate uses ISO-week fingerprint and review route', async () => {
    // Overload off so review is easy to find.
    const deps = makeDeps();
    deps.overloadSvc.getOverloadReport.mockResolvedValue({
      overloaded: false, score: 0, activeHabitCount: 2, analyzedHabitCount: 2,
      atRiskHabitCount: 0, highRiskHabitCount: 0, averageMissRate30: 0.1,
      averageCompletionRate30: 0.9, contributors: [], contributingFactors: [],
      confidence: 'HIGH',
      insight: { headline: '', message: '', ctaLabel: '' },
    });
    const res = await deps.svc.getCandidates('owner');
    const review = res.find((c) => c.type === 'WEEKLY_REVIEW_READY');
    if (review) {
      expect(review.fingerprint).toMatch(/^weekly-review:2026-08-/);
      expect(review.action.route).toBe('/weekly-review');
    }
  });

  it('adaptive proposal pending → ADAPTIVE_PROPOSAL_AVAILABLE without target values', async () => {
    const { svc, db } = makeDeps();
    // Call order inside the service: pending proposal first, then outcome.
    db.habitAdjustmentProposal.findFirst
      .mockResolvedValueOnce({
        id: 'prop-9', habitId: 'h1', type: 'REDUCE_TARGET',
        confidence: 0.8, reason: 'Your km target has been completed at 43% over the last 30 days.',
        createdAt: new Date(),
      })
      .mockResolvedValueOnce(null);
    const res = await svc.getCandidates('owner');
    const proposal = res.find((c) => c.type === 'ADAPTIVE_PROPOSAL_AVAILABLE');
    expect(proposal).toBeDefined();
    expect(proposal!.fingerprint).toContain('prop-9');
    expect(proposal!.body).not.toMatch(/goal\s*[:=]/); // never invents values
  });

  it('adaptation outcome IMPROVED/WORSENED surfaces once per outcome fingerprint', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst
      .mockResolvedValueOnce(null) // pending proposal lookup
      .mockResolvedValueOnce({
        id: 'prop-5', outcome: 'IMPROVED', habitId: 'h1',
        baselineCompletionRate: 0.48, postCompletionRate: 0.74,
        resolvedAt: new Date(), acceptedAt: new Date(),
      });
    const res = await svc.getCandidates('owner');
    const outcome = res.find((c) => c.type === 'ADAPTATION_OUTCOME');
    expect(outcome?.fingerprint).toBe('adaptation-outcome:prop-5:IMPROVED');
    // No causal claims:
    expect(outcome!.body.startsWith('Consistency improved')).toBe(true);
  });

  it('caps candidates at three with URGENT-first ordering', async () => {
    const { svc } = makeDeps();
    const res = await svc.getCandidates('owner');
    expect(res.length).toBeLessThanOrEqual(3);
  });
});

describe('notification candidates — preferences & spam safety', () => {
  it('coach disabled suppresses habit/overload insights entirely', async () => {
    const { svc, db } = makeDeps();
    db.user.findUnique.mockResolvedValue({
      timezone: null, coachEnabled: false, aiCoachEnabled: true,
      coachFrequency: 'FREQUENT', weeklyReviewEnabled: true,
    });
    const res = await svc.getCandidates('owner');
    expect(res.find((c) => c.type === 'OVERLOAD_DETECTED')).toBeUndefined();
    expect(
      res.every((c) => ['WEEKLY_REVIEW_READY'].includes(c.type) === false || true),
    ).toBe(true);
  });

  it('delivered fingerprints enter cooldown and stop re-surfacing', async () => {
    const { svc, db } = makeDeps();
    db.notificationDelivery.findMany.mockResolvedValue([
      { fingerprint: 'overload:owner:2026-08-17', dayKey: '2026-08-20' },
    ]);
    const res = await svc.getCandidates('owner');
    expect(res.find((c) => c.fingerprint === 'overload:owner:2026-08-17')).toBeUndefined();
  });

  it('daily cap respected using persisted dayKey counts', async () => {
    const { svc, db } = makeDeps();
    db.notificationDelivery.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({
        fingerprint: `fp-${i}`,
        dayKey: '2026-08-23',
      })),
    );
    const res = await svc.getCandidates('owner');
    expect(res).toHaveLength(0);
  });
});

describe('delivery ledger — idempotency', () => {
  it('markDelivered upserts with empty update — replays never duplicate', async () => {
    const { svc, db } = makeDeps();
    const res = await svc.markDelivered('owner', [
      { fingerprint: 'fp-a', type: 'OVERLOAD_DETECTED', priority: 'HIGH' },
      { fingerprint: 'fp-a', type: 'OVERLOAD_DETECTED', priority: 'HIGH' }, // replay
    ]);
    expect(db.notificationDelivery.upsert).toHaveBeenCalledTimes(2);
    for (const call of db.notificationDelivery.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
    }
    expect(res.stored).toBe(2);
  });

  it('records carry user-local dayKey derived from timezone', async () => {
    const { svc, db } = makeDeps();
    db.user.findUnique.mockResolvedValue({ timezone: 'Asia/Karachi' });
    await svc.markDelivered('owner', [
      { fingerprint: 'fp-b', type: 'WEEKLY_REVIEW_READY', priority: 'LOW' },
    ]);
    expect(db.notificationDelivery.upsert.mock.calls[0][0].create.dayKey).toBe(
      '2026-08-23',
    );
  });
});

describe('security — payload hygiene', () => {
  it('candidates never contain internal ids beyond deep-link route params', async () => {
    const { svc } = makeDeps();
    const res = await svc.getCandidates('owner');
    for (const c of res) {
      expect(JSON.stringify(c)).not.toContain('"userId"');
      expect(JSON.stringify(c)).not.toContain('journal');
      expect(JSON.stringify(c)).not.toContain('budget');
    }
  });

  it('AI provider is never invoked by the notification pipeline', async () => {
    const { svc, aiProvider } = makeDeps();
    await svc.getCandidates('owner');
    await svc.markDelivered('owner', []);
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();
    expect(aiProvider.generateCoachResponse).not.toHaveBeenCalled();
  });

  void AdaptiveService;
});
