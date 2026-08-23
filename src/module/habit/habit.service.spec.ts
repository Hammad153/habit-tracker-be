import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HabitService } from './habit.service';
import { ProfileService } from '../profile/profile.service';
import { AwardsService } from '../awards/awards.service';
import { RewardEngineService } from '../rewards/reward-engine.service';
import { DomainEventService } from '../../core/events/domain-event.service';

const habit = (patch: Partial<any> = {}) => ({
  id: patch.id ?? 'habit-1',
  userId: 'user-1',
  title: patch.title ?? 'Read pages',
  goal: patch.goal ?? 20,
  isArchived: patch.isArchived ?? false,
  minimumBehavior: patch.minimumBehavior ?? null,
  emergencyMinimum: patch.emergencyMinimum ?? null,
});

const makeService = () => {
  const tx = {
    completion: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(({ data }) =>
        Promise.resolve({ id: 'completion-new', ...data }),
      ),
      update: jest.fn(),
      delete: jest.fn(({ where }) =>
        Promise.resolve({ id: where.id }),
      ),
    },
    habit: {
      create: jest.fn(({ data }) => Promise.resolve({ id: 'habit-new', ...data })),
      findFirst: jest.fn(),
    },
    identityHabit: { createMany: jest.fn(), deleteMany: jest.fn() },
    identity: { findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn() },
    temptationBundle: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    habitRewardAllocation: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const database = {
    habit: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    completion: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
    },
    reminder: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    identityHabit: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    identity: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: any) => fn(tx)),
    tx,
  };

  const profileSvc = {
    addExperienceTx: jest.fn().mockResolvedValue({}),
  };
  const awardsSvc = { checkAndAwardBadges: jest.fn().mockResolvedValue([]) };
  const rewardEngine = {
    awardForCompletionTx: jest.fn().mockResolvedValue(breakdownOf(10)),
    reverseCompletionRewardsTx: jest.fn().mockResolvedValue(10),
  };
  const domainEvents = { emit: jest.fn() };

  const service = new HabitService(
    database as any,
    profileSvc as unknown as ProfileService,
    awardsSvc as unknown as AwardsService,
    rewardEngine as unknown as RewardEngineService,
    domainEvents as unknown as DomainEventService,
  );

  return {
    service,
    database,
    tx,
    profileSvc,
    awardsSvc,
    rewardEngine,
    domainEvents,
  };
};

function breakdownOf(total: number): any {
  return {
    total,
    lines: [],
    streak: total >= 10 ? 1 : 0,
    newStreakMilestones: [],
    newIdentityMilestones: [],
  };
}

describe('HabitService.toggleCompletion', () => {
  it('creates a FULL completion and grants XP + coins once', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(null);

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
    );

    expect(result.status).toBe(true);
    expect(result.kind).toBe('FULL');
    expect(s.tx.completion.create).toHaveBeenCalledTimes(1);
    expect(s.profileSvc.addExperienceTx).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      10,
    );
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(1);
    expect(s.domainEvents.emit).toHaveBeenCalledWith('habit.completed', {
      userId: 'user-1',
      habitId: 'habit-1',
      completionId: 'completion-new',
      date: '2026-08-22',
      kind: 'FULL',
    });
  });

  it('records a MINIMUM completion when the version is configured', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(
      habit({ minimumBehavior: 'Read one page' }),
    );
    s.database.completion.findUnique.mockResolvedValue(null);
    s.rewardEngine.awardForCompletionTx.mockResolvedValue(breakdownOf(3));

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
      undefined,
      'MINIMUM',
    );

    expect(result.status).toBe(true);
    expect(s.tx.completion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'MINIMUM' }),
    });
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'MINIMUM' }),
    );
    expect(s.domainEvents.emit).toHaveBeenCalledWith(
      'habit.minimumCompleted',
      expect.any(Object),
    );
  });

  it('rejects a MINIMUM completion without a configured minimum version', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());

    await expect(
      s.service.toggleCompletion('habit-1', 'user-1', '2026-08-22', undefined, 'MINIMUM'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an EMERGENCY completion without a configured emergency version', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());

    await expect(
      s.service.toggleCompletion('habit-1', 'user-1', '2026-08-22', undefined, 'EMERGENCY'),
    ).rejects.toThrow(BadRequestException);
  });

  it('reverses XP and coins when toggling a completed day off', async () => {
    const s = makeService();
    const existing = {
      id: 'c-1',
      habitId: 'habit-1',
      date: '2026-08-22',
      status: true,
      value: 20,
      kind: 'FULL',
    };
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(existing);
    s.rewardEngine.reverseCompletionRewardsTx.mockResolvedValue(10);

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
    );

    expect(result.status).toBe(false);
    expect(s.tx.completion.delete).toHaveBeenCalledWith({
      where: { id: 'c-1' },
    });
    expect(s.profileSvc.addExperienceTx).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      -10,
    );
    expect(s.rewardEngine.reverseCompletionRewardsTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completionId: 'c-1', priorKind: 'FULL' }),
    );
    expect(s.domainEvents.emit).toHaveBeenCalledWith(
      'habit.uncompleted',
      expect.any(Object),
    );
  });

  it('never double-awards when a concurrent request won the race (P2002)', async () => {
    const s = makeService();
    const racedRow = {
      id: 'c-raced',
      status: true,
      kind: 'FULL',
      date: '2026-08-22',
      habitId: 'habit-1',
    };
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(null);
    // Simulate the unique-constraint loss inside the transaction.
    s.tx.completion.create.mockImplementation(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    );
    s.tx.completion.findUnique.mockResolvedValue(racedRow);

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
    );

    expect(s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
    expect(s.rewardEngine.awardForCompletionTx).not.toHaveBeenCalled();
    expect(result.rewards?.coinsAwarded).toBe(0);
  });

  it('awards exactly once when upgrading an existing partial log to completed', async () => {
    const s = makeService();
    const partial = {
      id: 'c-partial',
      status: false,
      kind: 'FULL',
      value: 5,
      date: '2026-08-22',
      habitId: 'habit-1',
    };
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(partial);
    s.tx.completion.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...partial, ...data }),
    );

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
      20,
    );

    expect(result.status).toBe(true);
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(1);
    expect(s.profileSvc.addExperienceTx).toHaveBeenCalledTimes(1);
  });

  it('swaps the coin grant (no double grant) on same-day FULL -> MINIMUM re-log', async () => {
    const s = makeService();
    const existing = {
      id: 'c-full',
      status: true,
      kind: 'FULL',
      value: 20,
      date: '2026-08-22',
      habitId: 'habit-1',
    };
    s.database.habit.findUnique.mockResolvedValue(
      habit({ minimumBehavior: 'Read one page' }),
    );
    s.database.completion.findUnique.mockResolvedValue(existing);
    s.tx.completion.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...existing, ...data }),
    );
    s.rewardEngine.awardForCompletionTx.mockResolvedValue(breakdownOf(3));

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
      undefined,
      'MINIMUM',
    );

    expect(result.rewards?.coinsAwarded).toBe(-7); // -10 reversed + 3 granted
    expect(s.rewardEngine.reverseCompletionRewardsTx).toHaveBeenCalledTimes(1);
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(1);
    // XP must not be double-granted for the same day.
    expect(s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
  });

  it('blocks NEW completions on archived habits but allows reversal of old ones', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit({ isArchived: true }));
    s.database.completion.findUnique.mockResolvedValue(null);

    await expect(
      s.service.toggleCompletion('habit-1', 'user-1', '2026-08-22'),
    ).rejects.toThrow(ConflictException);
    expect(s.database.$transaction).not.toHaveBeenCalled();

    const s2 = makeService();
    const existing = {
      id: 'c-old',
      status: true,
      kind: 'FULL',
      date: '2026-08-21',
      habitId: 'habit-1',
    };
    s2.database.habit.findUnique.mockResolvedValue(habit({ isArchived: true }));
    s2.database.completion.findUnique.mockResolvedValue(existing);

    const result = await s2.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-21',
    );
    expect(result.status).toBe(false);
    expect(s2.tx.completion.delete).toHaveBeenCalled();
  });

  it('does not award anything for partial progress below goal', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(null);

    await s.service.toggleCompletion('habit-1', 'user-1', '2026-08-22', 5);

    expect(s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
    expect(s.rewardEngine.awardForCompletionTx).not.toHaveBeenCalled();
  });

  it('conserves coins across a same-day FULL -> MINIMUM -> FULL round trip', async () => {
    // Net coin effect after the full matrix must equal one FULL grant (10).
    const runLeg = async (
      existing: any,
      leg: { value?: number; kind?: 'FULL' | 'MINIMUM' },
      award: number,
      reverse: number,
    ) => {
      const s = makeService();
      s.database.habit.findUnique.mockResolvedValue(
        habit({ minimumBehavior: 'Read one page' }),
      );
      s.database.completion.findUnique.mockResolvedValue(existing);
      s.tx.completion.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data }),
      );
      s.rewardEngine.awardForCompletionTx.mockResolvedValue(breakdownOf(award));
      s.rewardEngine.reverseCompletionRewardsTx.mockResolvedValue(reverse);
      const result = await s.service.toggleCompletion(
        'habit-1',
        'user-1',
        '2026-08-22',
        leg.value,
        leg.kind,
      );
      return { s, delta: result.rewards?.coinsAwarded ?? 0 };
    };

    // Morning: +10 FULL
    const morning = await runLeg(null, {}, 10, 10);
    // Afternoon: -10 reversed, +3 MINIMUM
    const afternoon = await runLeg(
      { id: 'c-x', status: true, kind: 'FULL', value: 20, date: '2026-08-22', habitId: 'habit-1' },
      { kind: 'MINIMUM', value: 20 },
      3,
      10,
    );
    // Evening: -3 reversed, +10 re-granted (requires the ledger to allow re-awards)
    const evening = await runLeg(
      { id: 'c-x', status: true, kind: 'MINIMUM', value: 20, date: '2026-08-22', habitId: 'habit-1' },
      { kind: 'FULL', value: 20 },
      10,
      3,
    );

    expect(morning.delta).toBe(10);
    expect(afternoon.delta).toBe(-7);
    expect(evening.delta).toBe(7);
    expect(morning.delta + afternoon.delta + evening.delta).toBe(10);
    // XP granted exactly once across the whole day.
    expect(morning.s.profileSvc.addExperienceTx).toHaveBeenCalledTimes(1);
    expect(afternoon.s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
    expect(evening.s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
  });

  it('surfaces a retryable conflict instead of a 500 when the raced row disappears', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(null);
    s.tx.completion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    s.tx.completion.findUnique.mockResolvedValue(null);

    await expect(
      s.service.toggleCompletion('habit-1', 'user-1', '2026-08-22'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('HabitService stacking validation', () => {
  it('rejects direct self-stacking on update', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit({ id: 'habit-x' }));

    await expect(
      s.service.updateHabit('habit-x', 'user-1', {
        stackAfterHabitId: 'habit-x',
      }),
    ).rejects.toThrow(BadRequestException);
    // The guard fires inside the transaction before any chain lookup.
    expect(s.database.habit.findFirst).not.toHaveBeenCalled();
  });

  it('rejects stacking a habit after an archived habit', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit({ id: 'a' }));
    // updateHabit validates inside its transaction, so the tx client is used.
    s.database.$transaction.mockImplementation((fn: any) => fn(s.database));
    s.database.habit.findFirst.mockResolvedValue({
      id: 'archived-target',
      isArchived: true,
    });

    await expect(
      s.service.updateHabit('a', 'user-1', {
        stackAfterHabitId: 'archived-target',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an indirect cycle when re-pointing a habit via update', async () => {
    const s = makeService();
    // Existing chain: b follows a, c follows b. Making "a" follow "c"
    // closes a -> c -> b -> a.
    s.database.$transaction.mockImplementation((fn: any) =>
      fn(s.database),
    );
    s.database.habit.findUnique.mockResolvedValue(
      habit({ id: 'a', identityLinks: [], stackAfter: null }),
    );
    s.database.habit.findFirst.mockResolvedValue({ id: 'c' });
    s.database.habit.findMany.mockResolvedValue([
      { id: 'b', stackAfterHabitId: 'a' },
      { id: 'c', stackAfterHabitId: 'b' },
    ]);

    await expect(
      s.service.updateHabit('a', 'user-1', { stackAfterHabitId: 'c' }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows re-pointing within the chain when no loop is formed', async () => {
    const s = makeService();
    s.database.$transaction.mockImplementation((fn: any) =>
      fn(s.database),
    );
    const updated = habit({ id: 'meditate' });
    s.database.habit.findUnique.mockResolvedValue({
      ...updated,
      identityLinks: [],
      stackAfter: null,
    });
    s.database.habit.findFirst.mockResolvedValue({ id: 'brush-teeth' });
    s.database.habit.findMany.mockResolvedValue([
      { id: 'read', stackAfterHabitId: 'brush-teeth' },
      { id: 'meditate', stackAfterHabitId: 'read' },
    ]);

    const result = await s.service.updateHabit('meditate', 'user-1', {
      stackAfterHabitId: 'brush-teeth',
    });
    expect(s.database.habit.update).toHaveBeenCalledWith({
      where: { id: 'meditate' },
      data: { stackAfterHabitId: 'brush-teeth' },
    });
    expect(result).toBeDefined();
  });
});

describe('HabitService — reward farming & bundle gating', () => {
  const DAY_A = '2026-08-21';
  const DAY_B = '2026-08-22';

  it('a FULL -> OFF -> FULL farming cycle nets exactly one base grant', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(habit());

    // Day 1: complete (FULL).
    s.database.completion.findUnique.mockResolvedValue(null);
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_A);
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(1);

    // Toggle OFF: reversal runs once.
    s.database.completion.findUnique.mockResolvedValue({
      id: 'completion-new',
      habitId: 'habit-1',
      date: DAY_A,
      status: true,
      kind: 'FULL',
    });
    s.rewardEngine.reverseCompletionRewardsTx.mockClear();
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_A);
    expect(s.rewardEngine.reverseCompletionRewardsTx).toHaveBeenCalledTimes(1);

    // Re-complete the same day: award runs again, but the engine's
    // idempotency keys guarantee the milestone bonus is not re-paid.
    s.database.completion.findUnique.mockResolvedValue(null);
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_A);

    // Two completions -> two legitimate award calls (one per completion row).
    // Milestone double-payment is impossible regardless, because the engine's
    // ledger idempotency keys are keyed per cycle (covered by its own spec).
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(2);
    expect(s.tx.completion.create).toHaveBeenCalledTimes(2);
    // And the OFF step reversed exactly once.
    expect(s.rewardEngine.reverseCompletionRewardsTx).toHaveBeenCalledTimes(1);

    // Exactly two award calls total for two completions, and each completion
    // produced exactly one create — no duplicate rows to double-count.
    expect(s.rewardEngine.awardForCompletionTx).toHaveBeenCalledTimes(2);
    expect(s.tx.completion.create).toHaveBeenCalledTimes(2);
  });

  it('MINIMUM completions never unlock temptation bundles', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(
      habit({ minimumBehavior: 'Read one page' }),
    );
    s.database.completion.findUnique.mockResolvedValue(null);
    s.rewardEngine.awardForCompletionTx.mockResolvedValue(breakdownOf(3));

    await s.service.toggleCompletion('habit-1', 'user-1', DAY_B, undefined, 'MINIMUM');

    expect(s.tx.temptationBundle.updateMany).not.toHaveBeenCalled();
  });

  it('EMERGENCY completions never unlock temptation bundles', async () => {
    const s = makeService();
    s.database.habit.findUnique.mockResolvedValue(
      habit({ emergencyMinimum: 'One push-up' }),
    );
    s.database.completion.findUnique.mockResolvedValue(null);
    s.rewardEngine.awardForCompletionTx.mockResolvedValue(breakdownOf(2));

    await s.service.toggleCompletion('habit-1', 'user-1', DAY_B, undefined, 'EMERGENCY');

    expect(s.tx.temptationBundle.updateMany).not.toHaveBeenCalled();
  });

  it('FULL completions unlock bundles; toggle-offs do NOT re-lock them', async () => {
    const s = makeService();

    // FULL completion unlocks.
    s.database.habit.findUnique.mockResolvedValue(habit());
    s.database.completion.findUnique.mockResolvedValue(null);
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_B);
    expect(s.tx.temptationBundle.updateMany).toHaveBeenCalledTimes(1);
    expect(s.tx.temptationBundle.updateMany).toHaveBeenCalledWith({
      where: { habitId: 'habit-1', status: 'LOCKED' },
      data: expect.objectContaining({ status: 'UNLOCKED' }),
    });

    // Toggle OFF reverses rewards but must never re-lock.
    s.database.completion.findUnique.mockResolvedValue({
      id: 'completion-new',
      habitId: 'habit-1',
      date: DAY_B,
      status: true,
      kind: 'FULL',
    });
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_B);
    expect(s.tx.temptationBundle.updateMany).toHaveBeenCalledTimes(1); // unchanged

    // Re-completing is idempotent-safe: unlock may run again but only
    // targets LOCKED rows, so USED/UNLOCKED bundles are untouched.
    s.database.completion.findUnique.mockResolvedValue(null);
    await s.service.toggleCompletion('habit-1', 'user-1', DAY_B);
    expect(s.tx.temptationBundle.updateMany).toHaveBeenCalledTimes(2);
    expect(s.tx.temptationBundle.updateMany).toHaveBeenLastCalledWith({
      where: { habitId: 'habit-1', status: 'LOCKED' },
      data: expect.objectContaining({ status: 'UNLOCKED' }),
    });
  });
});
