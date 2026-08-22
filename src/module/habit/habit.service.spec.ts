import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HabitService } from './habit.service';
import { ProfileService } from '../profile/profile.service';
import { AwardsService } from '../awards/awards.service';
import { RewardsService } from '../rewards/rewards.service';
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
    },
    identityHabit: { createMany: jest.fn(), deleteMany: jest.fn() },
    identity: { findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn() },
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
  const rewardsSvc = {
    awardForCompletion: jest.fn().mockResolvedValue(10),
    reverseCompletionAward: jest.fn().mockResolvedValue(10),
  };
  const domainEvents = { emit: jest.fn() };

  const service = new HabitService(
    database as any,
    profileSvc as unknown as ProfileService,
    awardsSvc as unknown as AwardsService,
    rewardsSvc as unknown as RewardsService,
    domainEvents as unknown as DomainEventService,
  );

  return {
    service,
    database,
    tx,
    profileSvc,
    awardsSvc,
    rewardsSvc,
    domainEvents,
  };
};

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
    expect(s.rewardsSvc.awardForCompletion).toHaveBeenCalledTimes(1);
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
    s.rewardsSvc.awardForCompletion.mockResolvedValue(3);

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
    expect(s.rewardsSvc.awardForCompletion).toHaveBeenCalledWith(
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
    s.rewardsSvc.reverseCompletionAward.mockResolvedValue(10);

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
    expect(s.rewardsSvc.reverseCompletionAward).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completionId: 'c-1', kind: 'FULL' }),
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
    s.tx.completion.findUniqueOrThrow.mockResolvedValue(racedRow);

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
    );

    expect(s.profileSvc.addExperienceTx).not.toHaveBeenCalled();
    expect(s.rewardsSvc.awardForCompletion).not.toHaveBeenCalled();
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
    expect(s.rewardsSvc.awardForCompletion).toHaveBeenCalledTimes(1);
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
    s.rewardsSvc.awardForCompletion.mockResolvedValue(3);

    const result = await s.service.toggleCompletion(
      'habit-1',
      'user-1',
      '2026-08-22',
      undefined,
      'MINIMUM',
    );

    expect(result.rewards?.coinsAwarded).toBe(-7); // -10 reversed + 3 granted
    expect(s.rewardsSvc.reverseCompletionAward).toHaveBeenCalledTimes(1);
    expect(s.rewardsSvc.awardForCompletion).toHaveBeenCalledTimes(1);
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
    expect(s.rewardsSvc.awardForCompletion).not.toHaveBeenCalled();
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
