import { RewardsService } from './rewards.service';

const p2002 = (): any => {
  const err = new Error('Unique constraint');
  (err as any).code = 'P2002';
  return err;
};

const makeService = (): { service: RewardsService; database: any } => {
  const database = {
    rewardLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 35 } }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'entry-1', ...data })),
    },
    user: {
      update: jest.fn(() => Promise.resolve({ coins: 45 })),
      findUnique: jest.fn().mockResolvedValue({ coins: 35 }),
    },
    $transaction: jest.fn((fn) => fn(database)),
  };
  return { service: new RewardsService(database), database };
};

const makeTx = (): any => {
  let entriesCreated = 0;
  const tx = {
    rewardLedger: {
      create: jest.fn(({ data }) => {
        entriesCreated += 1;
        return Promise.resolve({ id: `entry-${entriesCreated}`, ...data });
      }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: { update: jest.fn(() => Promise.resolve({ coins: 10 })) },
  };
  return tx;
};

describe('RewardsService', () => {
  it('creates a ledger entry and increments the cached balance atomically', async () => {
    const { service } = makeService();
    const tx = makeTx();

    const awarded = await service.awardForCompletion(tx, {
      userId: 'user-1',
      completionId: 'c-1',
      kind: 'FULL',
    });

    expect(awarded).toBe(10);
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        amount: 10,
        type: 'HABIT_COMPLETION',
        referenceType: 'COMPLETION',
        referenceId: 'c-1',
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { coins: { increment: 10 } },
    });
  });

  it('awards reduced amounts for MINIMUM and EMERGENCY kinds', () => {
    const { service } = makeService();
    expect(service.coinsForKind('MINIMUM')).toBe(3);
    expect(service.coinsForKind('EMERGENCY')).toBe(2);
  });

  it('allows a re-award after a reversal (same-day kind round-trip)', async () => {
    // Regression guard: the ledger must NOT enforce uniqueness on
    // (type, referenceId) for awards — FULL -> MINIMUM -> FULL is legal.
    const { service } = makeService();
    const tx = makeTx();
    tx.rewardLedger.findFirst
      .mockResolvedValueOnce({ id: 'orig-1', amount: 10 }); // reverse morning FULL

    await service.awardForCompletion(tx, { userId: 'u', completionId: 'c-1', kind: 'FULL' });
    await service.reverseCompletionAward(tx, { userId: 'u', completionId: 'c-1', kind: 'FULL' });
    const reAwarded = await service.awardForCompletion(tx, { userId: 'u', completionId: 'c-1', kind: 'FULL' });

    expect(reAwarded).toBe(10);
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(3); // award, reversal, re-award
  });

  it('reverses the latest unreversed award with a REVERSAL entry', async () => {
    const { service } = makeService();
    const tx = makeTx();
    tx.rewardLedger.findFirst.mockResolvedValue({
      id: 'orig-1',
      amount: 10,
      type: 'HABIT_COMPLETION',
    });

    const reversed = await service.reverseCompletionAward(tx, {
      userId: 'user-1',
      completionId: 'c-1',
      kind: 'FULL',
    });

    expect(reversed).toBe(10);
    expect(tx.rewardLedger.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'HABIT_COMPLETION',
          referenceType: 'COMPLETION',
          referenceId: 'c-1',
          reversalOfId: null,
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: -10,
        type: 'REVERSAL',
        referenceType: 'LEDGER_ENTRY',
        referenceId: 'orig-1',
        reversalOfId: 'orig-1',
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { coins: { decrement: 10 } },
      select: { coins: true },
    });
  });

  it('never double-reverses: unique(reversalOfId) makes the second attempt a no-op', async () => {
    const { service } = makeService();
    const tx = makeTx();
    tx.rewardLedger.findFirst
      .mockResolvedValueOnce({ id: 'orig-1', amount: 10 })
      .mockResolvedValueOnce(null); // after reversal nothing reversible remains

    const first = await service.reverseCompletionAward(tx, { userId: 'u', completionId: 'c-1', kind: 'FULL' });
    const second = await service.reverseCompletionAward(tx, { userId: 'u', completionId: 'c-1', kind: 'FULL' });

    expect(first).toBe(10);
    expect(second).toBe(0);
  });

  it('treats a lost reversal race (P2002) as already-reversed', async () => {
    const { service } = makeService();
    const tx = makeTx();
    tx.rewardLedger.findFirst.mockResolvedValue({ id: 'orig-1', amount: 10 });
    tx.rewardLedger.create.mockRejectedValue(p2002());
    const userUpdate = jest.fn();

    const reversed = await service.reverseCompletionAward({
      ...tx,
      user: { update: userUpdate },
    }, { userId: 'u', completionId: 'c-1', kind: 'FULL' });

    expect(reversed).toBe(0);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when there is no prior award to reverse', async () => {
    const { service } = makeService();
    const tx = makeTx();

    const reversed = await service.reverseCompletionAward(tx, {
      userId: 'user-1',
      completionId: 'c-none',
      kind: 'MINIMUM',
    });

    expect(reversed).toBe(0);
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('reconciles the authoritative ledger balance against the cached value', async () => {
    const { service, database } = makeService();
    const ok = await service.getBalance('user-1');
    expect(ok).toEqual({ balance: 35, cachedBalance: 35, consistent: true });

    database.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 40 } });
    const drifted = await service.reconcileBalance('user-1');
    expect(drifted).toEqual({
      ledgerBalance: 40,
      cachedUserBalance: 35,
      difference: -5,
      consistent: false,
    });
  });

  it('repairs drift explicitly and auditable, only when authorized to run', async () => {
    const { service, database } = makeService();
    database.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 40 } });
    database.user.findUnique.mockResolvedValue({ coins: 35 });

    const result = await service.repairBalanceFromCache('user-1', { authorizedBy: 'admin-7' });

    expect(result).toEqual({ adjustedBy: -5 });
    expect(database.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        amount: -5,
        type: 'ADJUSTMENT',
        referenceType: 'MANUAL_REPAIR',
        referenceId: 'admin-7',
      }),
    });
  });

  it('is a no-op repair when balances already agree', async () => {
    const { service, database } = makeService();
    const result = await service.repairBalanceFromCache('user-1');

    expect(result).toEqual({ adjustedBy: 0 });
    expect(database.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('caps transaction history page size', async () => {
    const { service, database } = makeService();
    await service.listTransactions('user-1', { take: 5000 });
    expect(database.rewardLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});
