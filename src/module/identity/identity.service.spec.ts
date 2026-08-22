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
  ...patch,
});

const makeService = () => {
  const database = {
    identity: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
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
    completion: { findMany: jest.fn().mockResolvedValue([]) },
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
    database.completion.findMany.mockResolvedValue([
      { kind: 'FULL', date: '2026-08-22', habitId: 'h1' },
    ]);
    database.identity.update.mockResolvedValue({
      ...identityBase(),
      status: 'ARCHIVED',
    });

    const result = await service.delete('user-1', 'id-1');
    expect(database.identity.delete).not.toHaveBeenCalled();
    expect(result.archived).toBe(true);
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
  it('derives deterministic evidence from linked-habit completions', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase({ id: 'id-ath' }));
    database.identity.findFirstOrThrow.mockResolvedValue(
      identityBase({ id: 'id-ath', habitLinks: [] }),
    );
    database.identityHabit.findMany
      .mockResolvedValueOnce([
        { identityId: 'id-ath', habitId: 'run' },
        { identityId: 'id-ath', habitId: 'water' },
      ])
      .mockResolvedValue([]);
    database.completion.findMany.mockResolvedValue([
      { kind: 'FULL', date: '2026-08-21', habitId: 'run' },
      { kind: 'FULL', date: '2026-08-20', habitId: 'water' },
      { kind: 'MINIMUM', date: '2026-08-19', habitId: 'run' },
      { kind: 'EMERGENCY', date: '2026-08-18', habitId: 'run' },
      // A failed day (status=false rows are filtered by the query itself).
    ]);

    const result = await service.findOne('user-1', 'id-ath');

    expect(result.evidencePoints).toBe(6); // 2+2+1+1
    expect(result.kindCounts).toEqual({ FULL: 2, MINIMUM: 1, EMERGENCY: 1 });
    expect(result.level).toBe(1);
  });

  it('counts completedOnDate only against the client-supplied date key', async () => {
    const { service, database } = makeService();
    database.identity.findFirst.mockResolvedValue(identityBase());
    database.identity.findFirstOrThrow.mockResolvedValue(
      identityBase({ habitLinks: [] }),
    );
    database.identityHabit.findMany.mockResolvedValue([
      { identityId: 'id-ath', habitId: 'run' },
      { identityId: 'id-ath', habitId: 'water' },
    ]);
    database.completion.findMany.mockResolvedValue([
      { kind: 'FULL', date: '2026-08-22', habitId: 'run' },
      { kind: 'MINIMUM', date: '2026-08-22', habitId: 'water' },
      { kind: 'FULL', date: '2026-08-21', habitId: 'run' },
    ]);

    const result = await service.findOne('user-1', 'id-ath', '2026-08-22');
    expect(result.completedOnDate).toBe(2);

    const otherDay = await service.findOne('user-1', 'id-ath', '2026-08-21');
    expect(otherDay.completedOnDate).toBe(1);
  });
});
