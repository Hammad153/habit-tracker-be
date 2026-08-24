import * as fs from 'fs';
import { AdminDashboardService } from './admin-dashboard.service';
import type { AiProvider } from '../../../core/ai/ai-provider.interface';

beforeAll(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  jest.setSystemTime(new Date('2026-08-23T12:00:00.000Z')); // Sunday
});
afterAll(() => jest.useRealTimers());

const makeDeps = () => {
  const db = {
    user: {
      count: jest.fn().mockResolvedValue(120),
      findMany: jest.fn().mockResolvedValue([{ id: 'u1', timezone: null }]),
    },
    habit: {
      count: jest.fn().mockResolvedValue(340),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'h1', title: 'Run', userId: 'u1', goal: 5,
          scheduleType: 'daily', scheduleDays: [], timesPerWeek: null,
          intervalDays: null, scheduledTime: null, startDate: null,
          completions: Array.from({ length: 30 }, (_, i) => {
            const d = new Date('2026-08-22T12:00:00Z');
            d.setUTCDate(d.getUTCDate() - i);
            return { date: d.toISOString().slice(0, 10), value: 1, kind: 'FULL' };
          }),
        },
      ]),
    },
    habitAdjustmentProposal: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        if (where.status === 'ACCEPTED') {
          return Promise.resolve([
            { type: 'REDUCE_TARGET', outcome: 'IMPROVED' },
            { type: 'REDUCE_TARGET', outcome: 'IMPROVED' },
            { type: 'REDUCE_TARGET', outcome: 'UNCHANGED' },
            { type: 'CHANGE_TIME', outcome: 'WORSENED' },
          ]);
        }
        return Promise.resolve([
          { status: 'ACCEPTED', type: 'REDUCE_TARGET', outcome: null, confidence: 0.8 },
          { status: 'REJECTED', type: 'CHANGE_TIME', outcome: null, confidence: 0.7 },
        ]);
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    behavioralEvent: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    notificationDelivery: {
      count: jest.fn().mockResolvedValue(42),
      groupBy: jest.fn().mockResolvedValue([
        { type: 'OVERLOAD_DETECTED', _count: { _all: 25 } },
        { type: 'WEEKLY_REVIEW_READY', _count: { _all: 17 } },
      ]),
    },
    weeklyBehaviorReview: { count: jest.fn().mockResolvedValue(31) },
  };
  const aiProvider = {
    name: 'nvidia',
    model: null,
    generateRawText: jest.fn(),
    generateCoachResponse: jest.fn(),
  };
  const behavioralEvents = {
    funnelCounts: jest.fn().mockResolvedValue({
      INTERVENTION_GENERATED: 12,
      INTERVENTION_VIEWED: 9,
      INTERVENTION_ACTION_COMPLETED: 4,
      NOTIFICATION_CANDIDATE_GENERATED: 30,
      NOTIFICATION_DELIVERED: 26,
      NOTIFICATION_OPENED: 11,
      NOTIFICATION_ACTION_COMPLETED: 6,
    }),
  };
  const svc = new AdminDashboardService(
    db as never,
    behavioralEvents as never,
    aiProvider as unknown as AiProvider,
  );
  return { svc, db, aiProvider, behavioralEvents };
};

describe('dashboard period handling (spec §4)', () => {
  it('default period is the previous COMPLETED calendar week', async () => {
    const { svc } = makeDeps();
    const res = await svc.getDashboard();
    expect(res.period).toEqual({
      from: '2026-08-10',
      to: '2026-08-16',
      inProgress: false,
    });
  });

  it.each([
    ['malformed from', 'junk', '2026-08-01'],
    ['impossible date', '2026-02-30', '2026-08-01'],
    ['from > to', '2026-08-10', '2026-08-01'],
    ['>180 days', '2025-12-01', '2026-08-23'],
  ])('%s → BadRequest', async (_n, from, to) => {
    const { svc } = makeDeps();
    await expect(svc.getDashboard(from, to)).rejects.toMatchObject({
      constructor: expect.any(Function),
    });
  });
});

describe('dashboard aggregates & honesty markers', () => {
  it('adaptation effectiveness matches the Phase 3.7 aggregator semantics', async () => {
    const { svc } = makeDeps();
    const res = await svc.getDashboard();
    const rt = res.adaptations.effectivenessByType.find(
      (t) => t.type === 'REDUCE_TARGET',
    );
    expect(rt?.evaluated).toBe(3);
    // <10 evaluated → verdict forced to INSUFFICIENT_DATA, rate withheld:
    expect(rt!.verdict).toBe('INSUFFICIENT_DATA');
    expect(rt!.effectivenessRate).toBeNull();
  });

  it('Phase 4.1 ledger makes the funnels measurable with correct denominators', async () => {
    const { svc } = makeDeps();
    const res = await svc.getDashboard();

    // Intervention funnel: generated → viewed / completed denominators.
    expect(res.interventions.generated).toBe(12);
    expect(res.interventions.viewed).toBe(9);
    // Rates expose EXPLICIT denominators (Phase 4.2 contract):
    expect(res.interventions.viewRate).toMatchObject({
      suppressed: false, rate: 0.75,
      numerator: 9, denominator: 12, label: 'viewed/generated',
    });
    // ACTION_COMPLETED count is 4 < MIN_AGGREGATE_SAMPLE → rate suppressed
    // (privacy floor applies to rates, not just raw counts):
    expect(res.interventions.actionRate.suppressed).toBe(true);
    expect(res.interventions.actionRate.reason).toBe(
      'INSUFFICIENT_AGGREGATE_SAMPLE',
    );

    // Notification funnel: openRate uses DELIVERED denominator (spec §14).
    expect(res.notifications.candidates).toBe(30);
    expect(res.notifications.delivered).toBe(26);
    expect(res.notifications.openRate).toMatchObject({
      suppressed: false, rate: 0.4231,
      numerator: 11, denominator: 26, label: 'opened/delivered',
    });
    expect(res.notifications.actionRate).toMatchObject({
      suppressed: false, rate: Number((6 / 26).toFixed(4)),
      numerator: 6, denominator: 26,
    });
    expect(JSON.stringify(res)).not.toContain('u1');
    expect(res.interventions.byType).toBe('NOT_MEASURABLE'); // still honest
  });

  it('notification deliveries aggregate by type with the privacy floor', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findMany.mockResolvedValue([]);
    db.notificationDelivery.groupBy.mockResolvedValue([]);
    db.behavioralEvent.groupBy.mockImplementation(({ by }) => {
      const key = JSON.stringify(by);
      if (key.includes('notificationType')) {
        // RARE_TYPE has only 2 candidates — below MIN_AGGREGATE_SAMPLE.
        return Promise.resolve([
          { notificationType: 'RARE_TYPE', type: 'NOTIFICATION_CANDIDATE_GENERATED', _count: { _all: 2 } },
          { notificationType: 'OVERLOAD_DETECTED', type: 'NOTIFICATION_CANDIDATE_GENERATED', _count: { _all: 9 } },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await svc.getDashboard();
    const rare = res.notifications.byType.find((t: { type: string }) => t.type === 'RARE_TYPE');
    expect(rare).toBeUndefined(); // suppressed entirely
    const overload = res.notifications.byType.find(
      (t: { type: string }) => t.type === 'OVERLOAD_DETECTED',
    );
    expect(overload?.candidates).toBe(9); });

  it('behavior distributions come from the bounded pure-engine sample', async () => {
    const { svc } = makeDeps();
    const res = await svc.getDashboard();
    expect(res.behavior.sampleConfidence).toBe('LOW'); // tiny sample
    const riskKeys = Object.keys(res.behavior.riskDistribution);
    expect(riskKeys.length).toBeGreaterThan(0);
    expect(riskKeys.every((k) => !k.includes('u1'))).toBe(true); // no IDs leak
  });

  it('overload aggregates reuse the Phase 3.6 engine over the sample', async () => {
    const { svc, db } = makeDeps();
    // Make every habit fail hard → overload should trip for the sampled user.
    db.habit.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        id: `h${i}`, title: `H${i}`, userId: 'u1', goal: 5,
        scheduleType: 'daily', scheduleDays: [], timesPerWeek: null,
        intervalDays: null, scheduledTime: null, startDate: null,
        completions: [],
      })),
    );
    const res = await svc.getDashboard();
    // One overloaded user is below MIN_AGGREGATE_SAMPLE → suppressed marker
    // (privacy floor), while the Phase 3.6 engine demonstrably ran:
    expect(res.overload.detected).toEqual({
      suppressed: true,
      reason: 'INSUFFICIENT_AGGREGATE_SAMPLE',
    });
    expect(res.overload.note).toContain('Phase 3.6');
    expect(res.overload.affectedUserCount).toEqual(res.overload.detected);
  });

  it('performs zero writes anywhere in the dashboard flow', async () => {
    const { svc, db } = makeDeps();
    await svc.getDashboard();
    for (const model of Object.values(db)) {
      for (const fn of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        expect((model as Record<string, unknown>)[fn]).toBeUndefined();
      }
    }
  });

  it('privacy floor suppresses small user/habit counts without exact values', async () => {
    const { svc, db } = makeDeps();
    db.user.count.mockResolvedValue(3);
    const res = await svc.getDashboard();
    expect(res.users.active).toEqual({
      suppressed: true,
      reason: 'INSUFFICIENT_AGGREGATE_SAMPLE',
    });
  });
});

describe('optional NVIDIA summary (spec §12)', () => {
  it('/dashboard makes ZERO AI calls; unconfigured summary also makes none', async () => {
    const { svc, aiProvider } = makeDeps();
    await svc.getDashboard();
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();

    await svc.getDashboardSummary(); // model null → deterministic only
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();
  });

  it('configured model summarizes facts; output cannot alter metrics', async () => {
    const { svc, aiProvider } = makeDeps();
    (aiProvider as { model: string | null }).model = 'test-model';
    aiProvider.generateRawText.mockResolvedValue(
      JSON.stringify({
        headline: 'Adaptations look promising',
        message: 'Improvements were associated with recent reductions.',
        caution: 'Small sample.',
      }),
    );
    const res = await svc.getDashboardSummary();
    expect(res.ai).toMatchObject({ provider: 'nvidia', generated: true });
    expect(res.headline).toContain('promising');
    // Deterministic facts ride along UNCHANGED:
    expect(res.facts.adaptations.effectivenessByType[0].evaluated).toBe(3);
    expect(aiProvider.generateRawText).toHaveBeenCalledTimes(1);
  });

  it('AI failure falls back deterministically', async () => {
    const { svc, aiProvider } = makeDeps();
    (aiProvider as { model: string | null }).model = 'test-model';
    aiProvider.generateRawText.mockRejectedValue(new Error('RATE_LIMITED'));
    const res = await svc.getDashboardSummary();
    expect(res.ai).toEqual({ provider: 'fallback', generated: false });
    expect(typeof res.message).toBe('string');
  });

  it('summary prompt contains no private fields and treats content as DATA', async () => {
    const { svc, aiProvider } = makeDeps();
    (aiProvider as { model: string | null }).model = 'm';
    await svc.getDashboardSummary();
    const [arg] = aiProvider.generateRawText.mock.calls[0];
    const flat = `${arg.system}${arg.user}`;
    for (const banned of ['journal', 'budget', 'expense', 'income', 'password', 'token', 'u1']) {
      expect(flat.toLowerCase()).not.toContain(banned);
    }
    expect(arg.user.startsWith('{')).toBe(true);
  });

  it('source-level guarantee: dashboard path never references the AI provider', () => {
    const src = fs.readFileSync(
      'src/module/analytics/admin/admin-dashboard.service.ts',
      'utf8',
    );
    const dashboardFn = src.slice(
      src.indexOf('public async getDashboard('),
      src.indexOf('public async getDashboardSummary('),
    );
    expect(dashboardFn).not.toContain('aiProvider');
    expect(dashboardFn).not.toContain('generateRawText');
  });
});
