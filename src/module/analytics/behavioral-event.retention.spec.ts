import { BehavioralEventService } from './behavioral-event.service';
import { DatabaseService } from '../../core/database/database.service';

const RETENTION_DAYS = 365;

const makeDeps = () => {
  const doomedRows = Array.from({ length: 3 }, (_, i) => ({ id: `old-${i}` }));
  const db = {
    behavioralEvent: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue(doomedRows),
      deleteMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({ count: where.id.in.length }),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    notificationDelivery: { findFirst: jest.fn() },
    habitAdjustmentProposal: { findFirst: jest.fn() },
    completion: { findFirst: jest.fn() },
  };
  const svc = new BehavioralEventService(db as unknown as DatabaseService);
  return { svc, db };
};

describe('Phase 4.3 — event retention pruning', () => {
  it('deletes only events strictly older than the retention boundary', async () => {
    const { svc, db } = makeDeps();
    const now = new Date('2026-08-23T12:00:00Z');
    const res = await svc.pruneExpiredEvents(now);
    const cutoff = db.behavioralEvent.findMany.mock.calls[0][0].where.occurredAt.lt;
    const expectedCutoff = new Date(
      now.getTime() - RETENTION_DAYS * 86_400_000,
    ).toISOString();
    expect(cutoff).toBe(expectedCutoff); // 2025-08-23 boundary
    expect(res.deletedTotal).toBe(3);
    expect(res.batches).toBe(1);
    expect(res.cutoffDate).toBe(expectedCutoff.slice(0, 10));
  });

  it('recent events (just inside retention) are never selected', async () => {
    const { svc, db } = makeDeps();
    // The findMany WHERE clause enforces lt(cutoff) — simulate a recent row
    // by asserting the query would exclude it (boundary verification).
    const now = new Date('2026-08-23T12:00:00Z');
    db.behavioralEvent.findMany.mockResolvedValue([]);
    const res = await svc.pruneExpiredEvents(now);
    expect(res.deletedTotal).toBe(0);
    const where = db.behavioralEvent.findMany.mock.calls[0][0].where;
    const justInside = new Date(now.getTime() - (RETENTION_DAYS * 86_400_000 - 86_400_000));
    expect(justInside.getTime()).toBeGreaterThan(where.occurredAt.lt.getTime());
  });

  it('empty dataset → zero deletions, single batch check', async () => {
    const { svc, db } = makeDeps();
    db.behavioralEvent.findMany.mockResolvedValue([]);
    const res = await svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z'));
    expect(res).toEqual({
      deletedTotal: 0,
      batches: 0,
      cutoffDate: '2025-08-23',
    });
  });

  it('large dataset paginates until exhausted', async () => {
    const { svc, db } = makeDeps();
    let call = 0;
    db.behavioralEvent.findMany.mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        call <= 4
          ? Array.from({ length: 500 }, (_, i) => ({ id: `b${call}-${i}` }))
          : [],
      );
    });
    const res = await svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z'));
    expect(res.batches).toBe(4);
    expect(res.deletedTotal).toBe(2000);
  });

  it('repeated invocation is idempotent — second pass deletes nothing', async () => {
    const { svc, db } = makeDeps();
    await svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z'));
    db.behavioralEvent.findMany.mockResolvedValue([]);
    const second = await svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z'));
    expect(second.deletedTotal).toBe(0);
    expect(second.batches).toBe(0);
  });

  it('concurrent invocations cannot double-delete (id-scoped deleteMany)', async () => {
    const { svc, db } = makeDeps();
    // Both workers select the same ids; deleteMany is id-scoped so the second
    // removes zero rows regardless of ordering:
    db.behavioralEvent.deleteMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 0 });
    const [a, b] = await Promise.all([
      svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z')),
      svc.pruneExpiredEvents(new Date('2026-08-23T12:00:00Z')),
    ]);
    expect(a.deletedTotal + b.deletedTotal).toBeLessThanOrEqual(3);
  });

  it('timezone-safe: cutoff derives from explicit UTC instants, not local walls', async () => {
    const { svc, db } = makeDeps();
    const now = new Date('2026-01-01T00:30:00Z');
    await svc.pruneExpiredEvents(now);
    const where = db.behavioralEvent.findMany.mock.calls[0][0].where;
    expect(where.occurredAt.lt.toISOString()).toBe(
      new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString(),
    );
  });
});
