import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemptationBundleStatus } from '@prisma/client';
import { TemptationBundleService } from './temptation-bundle.service';

const bundleRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'b-1',
  userId: 'user-1',
  habitId: 'habit-1',
  title: 'Movie night',
  description: null,
  status: TemptationBundleStatus.LOCKED,
  usedAt: null,
  unlockedAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

function makeDb(bundles: Array<Record<string, unknown>> = [], habits: Array<Record<string, unknown>> = []) {
  const state = { bundles: [...bundles], habits: [...habits] };
  const db = {
    habit: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          state.habits.find((h) => h.id === where.id && h.userId === where.userId) ?? null,
        ),
      ),
    },
    temptationBundle: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          state.bundles.find((b) => b.id === where.id && b.userId === where.userId) ?? null,
        ),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          state.bundles.filter(
            (b) => b.userId === where.userId && (!where.habitId || b.habitId === where.habitId),
          ),
        ),
      ),
      create: jest.fn(({ data }: any) => {
        const row = { id: `b-${state.bundles.length + 2}`, status: TemptationBundleStatus.LOCKED, ...data };
        state.bundles.push(row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        for (const b of state.bundles) {
          if (
            (!where.id || b.id === where.id) &&
            (!where.userId || b.userId === where.userId) &&
            (!where.status || b.status === where.status) &&
            (!where.habitId || b.habitId === where.habitId)
          ) {
            Object.assign(b, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
      deleteMany: jest.fn(({ where }: any) => {
        const before = state.bundles.length;
        state.bundles = state.bundles.filter((b) => !(b.id === where.id && b.userId === where.userId));
        return Promise.resolve({ count: before - state.bundles.length });
      }),
    },
  };
  return { service: new TemptationBundleService(db as any), db, state };
}

const OWNED_HABIT = { id: 'habit-1', userId: 'user-1', isArchived: false };

describe('TemptationBundleService', () => {
  it('creates a locked bundle for an owned, unarchived habit', async () => {
    const h = makeDb([], [OWNED_HABIT]);
    const created = await h.service.create('user-1', {
      habitId: 'habit-1',
      title: 'Movie night',
    } as any);
    expect(created.status).toBe(TemptationBundleStatus.LOCKED);
    expect(h.state.bundles).toHaveLength(1);
  });

  it("refuses to create for another user's habit", async () => {
    const h = makeDb([], [{ id: 'habit-1', userId: 'someone-else', isArchived: false }]);
    await expect(
      h.service.create('user-1', { habitId: 'habit-1', title: 'x' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(h.state.bundles).toHaveLength(0);
  });

  it('refuses to create for an archived habit', async () => {
    const h = makeDb([], [{ id: 'habit-1', userId: 'user-1', isArchived: true }]);
    await expect(
      h.service.create('user-1', { habitId: 'habit-1', title: 'x' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('never exposes another user’s bundle via findOne/update/remove/use', async () => {
    const foreign = bundleRow({ userId: 'attacker' });
    const h = makeDb([foreign]);
    await expect(h.service.findOne('user-1', 'b-1')).rejects.toThrow(NotFoundException);
    await expect(h.service.update('user-1', 'b-1', { title: 'hack' } as any)).rejects.toThrow(
      NotFoundException,
    );
    await expect(h.service.remove('user-1', 'b-1')).rejects.toThrow(NotFoundException);
    await expect(h.service.use('user-1', 'b-1')).rejects.toThrow(NotFoundException);
    expect(foreign.title).toBe('Movie night');
    expect(h.state.bundles).toHaveLength(1);
  });

  it('refuses editing a USED bundle but allows UNLOCKED edits', async () => {
    const h = makeDb([
      bundleRow({ id: 'b-used', status: TemptationBundleStatus.USED, usedAt: new Date() }),
      bundleRow({ id: 'b-open', status: TemptationBundleStatus.UNLOCKED }),
    ]);
    await expect(
      h.service.update('user-1', 'b-used', { title: 'new' } as any),
    ).rejects.toThrow(BadRequestException);
    await h.service.update('user-1', 'b-open', { title: 'new' } as any);
    expect(h.state.bundles.find((b) => b.id === 'b-open')!.title).toBe('new');
  });

  it('using a LOCKED bundle is rejected and leaves it locked', async () => {
    const h = makeDb([bundleRow()]);
    await expect(h.service.use('user-1', 'b-1')).rejects.toThrow(BadRequestException);
    expect(h.state.bundles[0].status).toBe(TemptationBundleStatus.LOCKED);
    expect(h.state.bundles[0].usedAt).toBeNull();
  });

  it('using a bundle transitions UNLOCKED -> USED exactly once', async () => {
    const h = makeDb([bundleRow({ status: TemptationBundleStatus.UNLOCKED })]);
    const used = await h.service.use('user-1', 'b-1');
    expect(used?.status).toBe(TemptationBundleStatus.USED);
    expect(used?.usedAt).toBeTruthy();

    // A duplicate/racing use request loses the atomic guard.
    await expect(h.service.use('user-1', 'b-1')).rejects.toThrow(BadRequestException);
  });

  it('unlockAllForHabitTx flips every LOCKED bundle and never re-locks or touches others', async () => {
    const rows = [
      bundleRow({ id: 'a', status: TemptationBundleStatus.LOCKED }),
      bundleRow({ id: 'b', status: TemptationBundleStatus.LOCKED }),
      bundleRow({ id: 'c', status: TemptationBundleStatus.USED }),
      bundleRow({ id: 'd', habitId: 'habit-2' }), // other habit, stays LOCKED
    ];
    const state = { bundles: rows };
    const tx = {
      temptationBundle: {
        updateMany: jest.fn(({ where, data }: any) => {
          let count = 0;
          for (const b of state.bundles) {
            if (
              (!where.habitId || b.habitId === where.habitId) &&
              (!where.status || b.status === where.status)
            ) {
              Object.assign(b, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        }),
      },
    };
    const count = await TemptationBundleService.unlockAllForHabitTx(tx as any, 'habit-1');
    expect(count).toBe(2);
    expect(rows.map((r) => r.status)).toEqual([
      TemptationBundleStatus.UNLOCKED,
      TemptationBundleStatus.UNLOCKED,
      TemptationBundleStatus.USED,
      TemptationBundleStatus.LOCKED,
    ]);
    // Unlock timestamps set for flipped rows only.
    expect(rows[0].unlockedAt).toBeTruthy();
    expect(rows[3].unlockedAt).toBeNull();
  });
});
