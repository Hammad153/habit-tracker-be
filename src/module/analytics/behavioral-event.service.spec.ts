import {
  BehavioralEventService,
} from './behavioral-event.service';
import { DatabaseService } from '../../core/database/database.service';

const makeDeps = () => {
  const db = {
    behavioralEvent: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: `evt-${Math.random().toString(36).slice(2, 8)}`, ...data }),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'evt-existing' }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    notificationDelivery: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'del-1', fingerprint: 'overload:u1:2026-08-17',
      }),
    },
    habitAdjustmentProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    completion: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = new BehavioralEventService(db as unknown as DatabaseService);
  return { svc, db };
};

describe('ledger — idempotency (DB unique collapse)', () => {
  it('duplicate logical event collapses via P2002 → deduplicated:true', async () => {
    const { svc, db } = makeDeps();
    const prismaError = Object.assign(
      new Error('Unique constraint failed'),
      { code: 'P2002' },
    );
    // Simulate PrismaClientKnownRequestError shape:
    Object.setPrototypeOf(prismaError, new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('dup', { code: 'P2002', clientVersion: '7' }));
    db.behavioralEvent.create.mockRejectedValueOnce(prismaError);

    const res = await svc.record('u1', {
      type: 'INTERVENTION_VIEWED',
      fingerprint: 'intervention:h1:viewed',
    });
    expect(res.deduplicated).toBe(true);
    expect(db.behavioralEvent.findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', fingerprint: 'intervention:h1:viewed', type: 'INTERVENTION_VIEWED' },
      }),
    );
  });

  it('concurrent duplicates hit the same unique key — one logical row', async () => {
    const { svc, db } = makeDeps();
    const PCE = require('@prisma/client').Prisma;
    const dup = new PCE.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7' });
    db.behavioralEvent.create
      .mockRejectedValueOnce(dup)
      .mockRejectedValueOnce(dup);
    const results = await Promise.all([
      svc.record('u1', { type: 'INTERVENTION_DISMISSED', fingerprint: 'fingerprint-dismissed' }),
      svc.record('u1', { type: 'INTERVENTION_DISMISSED', fingerprint: 'fingerprint-dismissed' }),
    ]);
    expect(results.every((r) => r.deduplicated)).toBe(true);
  });

  it('malformed fingerprints are rejected before any write', async () => {
    const { svc, db } = makeDeps();
    for (const bad of ['', 'short', 'a'.repeat(200), 'has space']) {
      await expect(
        svc.record('u1', { type: 'INTERVENTION_VIEWED', fingerprint: bad }),
      ).rejects.toThrow(/fingerprint/i);
    }
    expect(db.behavioralEvent.create).not.toHaveBeenCalled();
  });
});

describe('intervention funnel — server-authoritative transitions', () => {
  it('interactions require a prior GENERATED event', async () => {
    const { svc, db } = makeDeps();
    db.behavioralEvent.findFirst.mockResolvedValueOnce(null); // no GENERATED
    await expect(
      svc.recordInterventionInteraction('u1', 'fp-ghost', 'INTERVENTION_VIEWED'),
    ).rejects.toThrow(/No generated intervention/);
  });

  it('ACTION_COMPLETED requires a verified completion for the correlated habit today', async () => {
    const { svc, db } = makeDeps();
    db.behavioralEvent.findFirst.mockResolvedValue({
      id: 'gen',
      habitId: 'h1',
    }); // GENERATED exists (persists across both calls)
    db.completion.findFirst.mockResolvedValue(null); // NOT completed today

    await expect(
      svc.recordInterventionInteraction('u1', 'fingerprint-1', 'INTERVENTION_ACTION_COMPLETED'),
    ).rejects.toThrow(/requires a verified habit completion/);

    // And with a real completion, the event records:
    db.completion.findFirst.mockResolvedValue({ id: 'c1' });
    db.behavioralEvent.create.mockResolvedValueOnce({ id: 'ok' });
    const res = await svc.recordInterventionInteraction('u1', 'fingerprint-1', 'INTERVENTION_ACTION_COMPLETED');
    expect(res.deduplicated).toBe(false);
    expect(db.behavioralEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'INTERVENTION_ACTION_COMPLETED' }) }),
    );
  });
});

describe('notification funnel — delivery correlation (IDOR-safe)', () => {
  it('foreign or nonexistent delivery → Forbidden (indistinguishable)', async () => {
    const { svc, db } = makeDeps();
    db.notificationDelivery.findFirst.mockResolvedValue(null);
    await expect(
      svc.recordNotificationInteraction('intruder', 'del-9', 'NOTIFICATION_OPENED'),
    ).rejects.toThrow(/not found/i);
  });

  it('OPENED without DELIVERED first → impossible transition rejected', async () => {
    const { svc, db } = makeDeps();
    db.behavioralEvent.findFirst.mockResolvedValue(null); // no DELIVERED event
    await expect(
      svc.recordNotificationInteraction('u1', 'del-1', 'NOTIFICATION_OPENED'),
    ).rejects.toThrow(/not yet marked delivered/);
  });

  it('full funnel: DELIVERED → OPENED → ACTION_STARTED → ACTION_COMPLETED', async () => {
    const { svc, db } = makeDeps();
    // DELIVERED:
    await svc.recordDelivered('u1', 'del-1', 'overload:u1:2026-08-17');
    // Each interaction checks DELIVERED first, then its predecessor step.
    const deliveredRow = { id: 'd1', fingerprint: 'overload:u1:2026-08-17' };
    const gate = (id: string) => {
      db.behavioralEvent.findFirst
        .mockResolvedValueOnce(deliveredRow) // DELIVERED gate
        .mockResolvedValueOnce({ id });      // predecessor gate
    };
    gate('d-open'); // OPENED: predecessor = DELIVERED
    await svc.recordNotificationInteraction('u1', 'del-1', 'NOTIFICATION_OPENED');
    gate('o-start'); // ACTION_STARTED: predecessor = OPENED
    await svc.recordNotificationInteraction('u1', 'del-1', 'NOTIFICATION_ACTION_STARTED');
    gate('s-done'); // ACTION_COMPLETED: predecessor = ACTION_STARTED
    await svc.recordNotificationInteraction('u1', 'del-1', 'NOTIFICATION_ACTION_COMPLETED');

    const types = db.behavioralEvent.create.mock.calls.map(
      (c) => c[0].data.type,
    );
    expect(types).toEqual([
      'NOTIFICATION_DELIVERED',
      'NOTIFICATION_OPENED',
      'NOTIFICATION_ACTION_STARTED',
      'NOTIFICATION_ACTION_COMPLETED',
    ]);
  });

  it('ACTION_STARTED without OPENED → rejected at the OPENED gate', async () => {
    const { svc, db } = makeDeps();
    // Delivery exists (owned), but no DELIVERED/OPENED events recorded yet.
    db.behavioralEvent.findFirst.mockResolvedValue(null);
    await expect(
      svc.recordNotificationInteraction('u1', 'del-1', 'NOTIFICATION_ACTION_STARTED'),
    ).rejects.toThrow(/NOTIFICATION_DELIVERED|NOTIFICATION_OPENED/);
  });
});

describe('proposal lifecycle events — state machine respected', () => {
  it('foreign proposal → NotFound', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst.mockResolvedValue(null);
    await expect(
      svc.recordProposalEvent('intruder', 'p1', 'ADAPTIVE_PROPOSAL_VIEWED'),
    ).rejects.toThrow(/Proposal not found/);
  });

  it('ACCEPTED event requires ACCEPTED status; REJECTED event requires REJECTED status', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst.mockResolvedValue({
      id: 'p1', habitId: 'h1', status: 'PENDING',
    });
    await expect(
      svc.recordProposalEvent('u1', 'p1', 'ADAPTIVE_PROPOSAL_ACCEPTED'),
    ).rejects.toThrow(/not in ACCEPTED state/);
    await expect(
      svc.recordProposalEvent('u1', 'p1', 'ADAPTIVE_PROPOSAL_REJECTED'),
    ).rejects.toThrow(/not in REJECTED state/);
  });

  it('REJECTED ledger event cannot follow a prior ACCEPTED ledger event', async () => {
    const { svc, db } = makeDeps();
    // Defense-in-depth: even if the row state were manually flipped back,
    // the immutable ledger blocks the contradictory observation.
    db.habitAdjustmentProposal.findFirst.mockResolvedValue({
      id: 'p1', habitId: 'h1', status: 'REJECTED',
    });
    db.behavioralEvent.findFirst.mockResolvedValue({ id: 'acc' }); // prior ACCEPTED
    await expect(
      svc.recordProposalEvent('u1', 'p1', 'ADAPTIVE_PROPOSAL_REJECTED'),
    ).rejects.toThrow(/impossible transition/);
  });

  it('VIEWED records against the proposal correlation object', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst.mockResolvedValue({
      id: 'p1', habitId: 'h1', status: 'PENDING',
    });
    await svc.recordProposalEvent('u1', 'p1', 'ADAPTIVE_PROPOSAL_VIEWED');
    expect(db.behavioralEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ADAPTIVE_PROPOSAL_VIEWED',
          proposalId: 'p1',
          habitId: 'h1',
        }),
      }),
    );
  });
});

describe('aggregation helper', () => {
  it('funnelCounts groups by type within bounds', async () => {
    const { svc, db } = makeDeps();
    db.behavioralEvent.groupBy.mockResolvedValue([
      { type: 'INTERVENTION_GENERATED', _count: { _all: 10 } },
      { type: 'INTERVENTION_VIEWED', _count: { _all: 6 } },
    ]);
    const res = await svc.funnelCounts('u1', new Date('2026-08-01'), new Date('2026-08-23'));
    expect(res.INTERVENTION_GENERATED).toBe(10);
    expect(res.INTERVENTION_VIEWED).toBe(6);
  });
});
