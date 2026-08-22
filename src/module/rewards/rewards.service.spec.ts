import { RewardsService } from './rewards.service';

const makeService = () => {
  const database = {
    rewardLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 35 } }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'entry-1', ...data })),
    },
    user: {
      update: jest.fn(() => Promise.resolve({ coins: 45 })),
      findUnique: jest.fn().mockResolvedValue({ coins: 35 }),
    },
  };
  return { service: new RewardsService(database as any), database };
};

describe('RewardsService', () => {
  it('creates a ledger entry and increments the cached balance atomically', async () => {
    const { service } = makeService();
    const userUpdate = jest.fn().mockResolvedValue({ coins: 10 });
    const tx = { rewardLedger: { create: jest.fn().mockResolvedValue({}) }, user: { update: userUpdate } };

    const awarded = await service.awardForCompletion(tx as any, {
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
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { coins: { increment: 10 } },
    });
  });

  it('awards reduced amounts for MINIMUM and EMERGENCY kinds', () => {
    const { service } = makeService();
    expect(service.coinsForKind('MINIMUM')).toBe(3);
    expect(service.coinsForKind('EMERGENCY')).toBe(2);
  });

  it('is idempotent under races: a duplicate award changes nothing', async () => {
    const { service } = makeService();
    const p2002: any = new Error('Unique constraint');
    p2002.code = 'P2002';
    const userUpdate = jest.fn();
    const tx = {
      rewardLedger: { create: jest.fn().mockRejectedValue(p2002) },
      user: { update: userUpdate },
    };

    const awarded = await service.awardForCompletion(tx as any, {
      userId: 'user-1',
      completionId: 'c-1',
      kind: 'FULL',
    });

    expect(awarded).toBe(0);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('reverses an award with a REVERSAL entry and decrements the balance', async () => {
    const { service, database } = makeService();
    database.rewardLedger.findUnique.mockResolvedValue({
      id: 'orig-1',
      amount: 10,
      type: 'HABIT_COMPLETION',
      referenceId: 'c-1',
    });
    const userUpdate = jest.fn().mockResolvedValue({ coins: 0 });
    const tx = {
      rewardLedger: { findUnique: database.rewardLedger.findUnique, create: jest.fn().mockResolvedValue({}) },
      user: { update: userUpdate },
    };

    const reversed = await service.reverseCompletionAward(tx as any, {
      userId: 'user-1',
      completionId: 'c-1',
      kind: 'FULL',
    });

    expect(reversed).toBe(10);
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: -10,
        type: 'REVERSAL',
        referenceType: 'LEDGER_ENTRY',
        referenceId: 'orig-1',
      }),
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { coins: { decrement: 10 } },
      select: { coins: true },
    });
  });

  it('never double-reverses the same completion', async () => {
    const { service, database } = makeService();
    database.rewardLedger.findUnique.mockResolvedValue({
      id: 'orig-1',
      amount: 10,
      type: 'HABIT_COMPLETION',
      referenceId: 'c-1',
    });
    const p2002: any = new Error('Unique constraint');
    p2002.code = 'P2002';
    const userUpdate = jest.fn();
    const tx = {
      rewardLedger: {
        findUnique: database.rewardLedger.findUnique,
        create: jest.fn().mockRejectedValue(p2002),
      },
      user: { update: userUpdate },
    };

    const reversed = await service.reverseCompletionAward(tx as any, {
      userId: 'user-1',
      completionId: 'c-1',
      kind: 'FULL',
    });

    expect(reversed).toBe(0);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('reports ledger vs cached consistency for the balance endpoint', async () => {
    const { service, database } = makeService();
    const ok = await service.getBalance('user-1');
    expect(ok).toEqual({ balance: 35, cachedBalance: 35, consistent: true });

    database.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 40 } });
    const drifted = await service.getBalance('user-1');
    expect(drifted.consistent).toBe(false);
  });
});
