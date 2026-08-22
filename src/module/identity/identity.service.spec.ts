import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { IdentityService } from './identity.service';

const identityBase = (patch: Partial<any> = {}) => ({
  id: patch.id ?? 'id-1',
  userId: 'user-1',
  title: patch.title ?? 'Athlete',
  description: 'I am becoming an athlete.',
  icon: 'fitness',
  color: '#3B82F6',
  status: patch.status ?? 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  habitLinks: patch.habitLinks ?? [],
  ...patch,
});

const makeService = () => {
  const database = {
    identity: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }) =>
        Promise.resolve({ id: 'identity-new', ...data }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(({ where }) => Promise.resolve({ id: where.id })),
    },
    identityHabit: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    habit: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
    completion: {
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  return { service: new IdentityService(database as any), database };
};

describe('IdentityService', () => {
  it('creates an identity scoped to the authenticated user', async () => {
    const { service, database } = makeService();
    await service.create('user-1', { title: 'Reader' });
    expect(database.identity.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', title: 'Reader' },
    });
  });

  it("cannot read another user's identity", async () => {
    const { service } = makeService();
    // findFirst returns nothing because ownership is part of the where clause.
    await expect(service.findOne('user-2', 'id-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('archives instead of deleting an identity that carries evidence', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.identityHabit.findMany.mockResolvedValue([
      { identityId: 'id-1', habitId: 'h1' },
    ]);
    database.completion.findFirst.mockResolvedValue({ id: 'c-1' });
    database.identity.update.mockResolvedValue({
      ...identityBase(),
      status: 'ARCHIVED',
    });

    const result = await service.delete('user-1', 'id-1');
    expect(database.identity.delete).not.toHaveBeenCalled();
    expect(result.archived).toBe(true);
    // Existence check must be bounded, never a full history scan.
    expect(database.completion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } }),
    );
  });

  it('hard-deletes an identity with no evidence', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());

    const result = await service.delete('user-1', 'id-1');
    expect(database.identity.delete).toHaveBeenCalled();
    expect(result.archived).toBe(false);
  });

  it('links a habit to an identity', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.habit.findFirst.mockResolvedValue({ id: 'habit-9' });

    await service.linkHabit('user-1', 'id-1', 'habit-9');
    expect(database.identityHabit.create).toHaveBeenCalledWith({
      data: { identityId: 'id-1', habitId: 'habit-9' },
    });
  });

  it('rejects linking a habit the user does not own', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.habit.findFirst.mockResolvedValue(null);

    await expect(
      service.linkHabit('user-1', 'id-1', 'habit-other'),
    ).rejects.toThrow(NotFoundException);
  });

  it('reports duplicate links as a bad request', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.habit.findFirst.mockResolvedValue({ id: 'habit-9' });
    const p2002: any = new Error('dup');
    p2002.code = 'P2002';
    database.identityHabit.create.mockRejectedValue(p2002);

    await expect(
      service.linkHabit('user-1', 'id-1', 'habit-9'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unlinking a habit that is not linked', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.identityHabit.findUnique.mockResolvedValue(null);

    await expect(
      service.unlinkHabit('user-1', 'id-1', 'habit-x'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('IdentityService evidence progress', () => {
  it('derives deterministic evidence from grouped completion counts', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(
      identityBase({ id: 'id-ath' }),
    );
    database.identity.findMany.mockResolvedValue([
      identityBase({
        id: 'id-ath',
        habitLinks: [
          { habitId: 'run', habit: {} },
          { habitId: 'water', habit: {} },
        ],
      }),
    ]);
    database.identityHabit.findMany.mockResolvedValue([
      { identityId: 'id-ath', habitId: 'run' },
      { identityId: 'id-ath', habitId: 'water' },
    ]);
    database.completion.groupBy.mockResolvedValue([
      { kind: 'FULL', habitId: 'run', _count: { _all: 2 } },
      { kind: 'FULL', habitId: 'water', _count: { _all: 1 } },
      { kind: 'MINIMUM', habitId: 'run', _count: { _all: 1 } },
      { kind: 'EMERGENCY', habitId: 'run', _count: { _all: 1 } },
    ]);

    const result = await service.findOne('user-1', 'id-ath');

    expect(result.evidencePoints).toBe(8); // (3 FULL x2) + 1 + 1
    expect(result.kindCounts).toEqual({ FULL: 3, MINIMUM: 1, EMERGENCY: 1 });
    // 8 points < 15 -> still level 1.
    expect(result.level).toBe(1);
    expect(database.completion.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['kind', 'habitId'],
        where: { habitId: { in: ['run', 'water'] }, status: true },
      }),
    );
  });

  it('counts completedOnDate only against the client-supplied date key', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.identity.findMany.mockResolvedValue([
      identityBase({
        id: 'id-ath',
        habitLinks: [
          { habitId: 'run', habit: {} },
          { habitId: 'water', habit: {} },
        ],
      }),
    ]);
    database.identityHabit.findMany.mockResolvedValue([
      { identityId: 'id-ath', habitId: 'run' },
      { identityId: 'id-ath', habitId: 'water' },
    ]);

    database.completion.findMany.mockResolvedValue([
      { habitId: 'run' },
      { habitId: 'water' },
    ]);
    const result = await service.findOne('user-1', 'id-ath', '2026-08-22');
    expect(database.completion.findMany).toHaveBeenCalledWith({
      where: {
        habitId: { in: ['run', 'water'] },
        date: '2026-08-22',
        status: true,
      },
      select: { habitId: true },
    });
    expect(result.completedOnDate).toBe(2);

    database.completion.findMany.mockResolvedValue([{ habitId: 'run' }]);
    const otherDay = await service.findOne('user-1', 'id-ath', '2026-08-21');
    expect(otherDay.completedOnDate).toBe(1);
  });

  it('never shares counts between identities linked to different habits', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase({ id: 'a' }));
    database.identity.findMany.mockResolvedValue([
      identityBase({ id: 'a', habitLinks: [{ habitId: 'h1', habit: {} }] }),
      identityBase({ id: 'b', habitLinks: [{ habitId: 'h2', habit: {} }] }),
    ]);
    database.identityHabit.findMany.mockResolvedValue([
      { identityId: 'a', habitId: 'h1' },
      { identityId: 'b', habitId: 'h2' },
    ]);
    database.completion.groupBy.mockResolvedValue([
      { kind: 'FULL', habitId: 'h1', _count: { _all: 4 } },
    ]);

    const list = await service.findAll('user-1');
    const a = list.find((i) => i.id === 'a') as any;
    const b = list.find((i) => i.id === 'b') as any;
    expect(a.kindCounts.FULL).toBe(4);
    expect(b.kindCounts.FULL).toBe(0);
  });

  it('rejects malformed client dates instead of deriving one server-side', async () => {
    const { service } = makeService();
    await expect(service.findAll('user-1', '08/22/2026')).rejects.toThrow(
      BadRequestException,
    );
  });
});
