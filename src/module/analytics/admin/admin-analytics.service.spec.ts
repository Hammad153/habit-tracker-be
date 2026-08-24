import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { AdminAnalyticsService } from './admin-analytics.service';
import { DatabaseService } from '../../../core/database/database.service';

const makeDeps = () => {
  const db = {
    user: { count: jest.fn().mockResolvedValue(120) },
    habit: { count: jest.fn().mockResolvedValue(340), findFirst: jest.fn() },
    habitAdjustmentProposal: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    notificationDelivery: { groupBy: jest.fn().mockResolvedValue([]) },
    weeklyBehaviorReview: { count: jest.fn().mockResolvedValue(40) },
  };
  const svc = new AdminAnalyticsService(db as unknown as DatabaseService);
  return { svc, db };
};

const acceptedRow = (
  type: string,
  outcome: 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | 'INSUFFICIENT_DATA',
) => ({ type, outcome });

describe('AdminAnalyticsService — date validation', () => {
  it.each([
    ['malformed from', 'not-a-date', '2026-08-01'],
    ['impossible date', '2026-02-30', '2026-08-01'],
    ['malformed to', '2026-06-01', 'June'],
    ['impossible to', '2026-06-01', '2026-13-01'],
  ])('%s → BadRequest', async (_n, from, to) => {
    const { svc } = makeDeps();
    await expect(svc.getAdaptationEffectiveness(from, to)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('from > to → BadRequest', async () => {
    const { svc } = makeDeps();
    await expect(
      svc.getAdaptationEffectiveness('2026-08-10', '2026-08-01'),
    ).rejects.toThrow(BadRequestException);
  });

  it('range beyond 180 days → BadRequest', async () => {
    const { svc } = makeDeps();
    await expect(
      svc.getAdaptationEffectiveness('2025-12-01', '2026-08-01'),
    ).rejects.toThrow(/180/);
  });

  it('valid range echoes the window; defaults are bounded', async () => {
    const { svc, db } = makeDeps();
    const res = await svc.getAdaptationEffectiveness('2026-07-01', '2026-07-31');
    expect(res.window).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    void db;
    const defaulted = await svc.getAdaptationEffectiveness();
    expect(defaulted.window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('AdminAnalyticsService — privacy floor & aggregates', () => {
  it('types below MIN_AGGREGATE_SAMPLE are suppressed without exact counts', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findMany.mockResolvedValue([
      acceptedRow('REDUCE_TARGET', 'IMPROVED'),
      acceptedRow('REDUCE_TARGET', 'WORSENED'),
    ]);
    const res = await svc.getAdaptationEffectiveness();
    expect(res.sampleStatus).toBe('INSUFFICIENT');
    const rt = res.proposalTypes.find((p) => p.type === 'REDUCE_TARGET') as Record<
      string,
      unknown
    >;
    expect(rt.suppressed).toBe(true);
    expect(rt.reason).toBe('INSUFFICIENT_AGGREGATE_SAMPLE');
    // Suppressed rows expose no counts:
    expect(rt.evaluated).toBeUndefined();
    expect(rt.improved).toBeUndefined();
    expect(res.overall.suppressed).toBe(true);
    expect(res.insights).toHaveLength(0); // thin evidence never yields insights
  });

  it('sufficient samples expose aggregates with PROMISING verdict mapping and TUNING INSIGHT labels', async () => {
    const { svc, db } = makeDeps();
    const rows = [
      ...Array.from({ length: 13 }, () => acceptedRow('REDUCE_TARGET', 'IMPROVED')),
      ...Array.from({ length: 4 }, () => acceptedRow('REDUCE_TARGET', 'UNCHANGED')),
      ...Array.from({ length: 3 }, () => acceptedRow('REDUCE_TARGET', 'WORSENED')),
    ];
    db.habitAdjustmentProposal.findMany.mockResolvedValue(rows);
    const res = await svc.getAdaptationEffectiveness();
    expect(res.sampleStatus).toBe('SUFFICIENT');
    const rt = res.proposalTypes.find((p) => p.type === 'REDUCE_TARGET') as any;
    expect(rt.verdict).toBe('PROMISING'); // EFFECTIVE mapped for product language
    expect(rt.improvementRate).toBeCloseTo(13 / 20, 4);
    expect(res.insights.length).toBeGreaterThan(0);
    expect(res.insights.every((i) => i.label === 'TUNING INSIGHT')).toBe(true);
  });

  it('overview uses aggregate queries only and applies the floor', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.groupBy
      .mockResolvedValueOnce([{ status: 'ACCEPTED', _count: { _all: 25 } }])
      .mockResolvedValueOnce([{ outcome: 'IMPROVED', _count: { _all: 14 } }]);
    db.notificationDelivery.groupBy.mockResolvedValue([
      { type: 'OVERLOAD_DETECTED', _count: { _all: 60 } },
    ]);
    const res = await svc.getOverview();
    expect(res.users.totalActive).toBe(120);
    expect(res.proposals.accepted).toBe(25);
    expect((res.outcomes.improved as number)).toBe(14);
    expect(res.privacyFloor).toBe(5);
    // Read-only proof:
    for (const key of Object.keys(db)) {
      const model = (db as never as Record<string, Record<string, jest.Mock>>)[key];
      for (const fn of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        expect(model[fn]).toBeUndefined();
      }
    }
  });

  it('zero NVIDIA surface exists in the admin layer', () => {
    const src = fs.readFileSync(
      'src/module/analytics/admin/admin-analytics.service.ts',
      'utf8',
    );
    expect(src).not.toContain('AiProvider');
    expect(src).not.toContain('generateRawText');
  });
});
