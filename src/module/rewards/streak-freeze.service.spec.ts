import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StreakFreezeService } from './streak-freeze.service';

/**
 * Streak-freeze anti-exploit & validation matrix.
 * The fake database enforces the (habitId, date) unique constraint and tracks
 * ledger entries so tests can assert "no charge on failure" and
 * "User.coins === SUM(ledger)".
 */

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const TODAY = '2026-08-22';
// Freeze "now" at noon UTC of TODAY for deterministic comparisons.
beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
});
afterAll(() => {
  jest.useRealTimers();
});

function makeDb(options?: {
  coins?: number;
  habit?: Record<string, unknown> | null;
  completedDate?: boolean;
}) {
  const state = {
    coins: options?.coins ?? 1000,
    entries: [] as Array<{ id: string; amount: number; type: string }>,
    freezes: [] as Array<{ id: string; userId: string; habitId: string; date: string; cost: number }>,
    nextId: 1,
  };

  const habitRow =
    options?.habit === undefined
      ? {
          id: 'habit-1',
          userId: 'user-1',
          isArchived: false,
          scheduleType: 'daily',
          scheduleDays: null,
          timesPerWeek: null,
          intervalDays: null,
          startDate: null,
        }
      : options.habit;

  const tx = {
    habit: { findUnique: jest.fn(() => Promise.resolve(habitRow ? { ...habitRow } : null)) },
    completion: {
      findFirst: jest.fn(() =>
        Promise.resolve(options?.completedDate ? { id: 'c-x' } : null),
      ),
    },
    streakFreeze: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          state.freezes.find(
            (f) => f.habitId === where.habitId_date.habitId && f.date === where.habitId_date.date,
          ) ?? null,
        ),
      ),
      create: jest.fn(({ data }: any) => {
        if (state.freezes.some((f) => f.habitId === data.habitId && f.date === data.date)) {
          return Promise.reject(p2002());
        }
        const freeze = { id: `freeze-${state.nextId++}`, ...data };
        state.freezes.push(freeze);
        return Promise.resolve(freeze);
      }),
    },
    rewardLedger: {
      create: jest.fn(({ data }: any) => {
        const entry = { id: `entry-${state.nextId++}`, ...data };
        state.entries.push(entry);
        return Promise.resolve(entry);
      }),
    },
    user: {
      findUnique: jest.fn(() => Promise.resolve({ coins: state.coins })),
      update: jest.fn(({ data }: any) => {
        state.coins -= data.coins.decrement;
        return Promise.resolve({ coins: state.coins });
      }),
    },
  };

  const db = { $transaction: jest.fn((fn: any) => fn(tx)) };
  const ledgerSum = () => state.entries.reduce((s, e) => s + e.amount, 0);
  return { service: new StreakFreezeService(db as any), tx, state, ledgerSum };
}

const purchase = (
  service: StreakFreezeService,
  overrides?: Partial<{ userId: string; habitId: string; date: string }>,
) =>
  service.purchaseFreeze(
    overrides?.userId ?? 'user-1',
    overrides?.habitId ?? 'habit-1',
    overrides?.date ?? TODAY,
  );

describe('StreakFreezeService — purchase & anti-exploit', () => {
  it('purchases a freeze: one row, one -100 ledger entry, balance reduced', async () => {
    const h = makeDb({ coins: 500 });
    const freeze = await purchase(h.service);

    expect(freeze).toMatchObject({ userId: 'user-1', habitId: 'habit-1', date: TODAY, cost: 100 });
    expect(h.state.freezes).toHaveLength(1);
    expect(h.state.entries).toHaveLength(1);
    expect(h.state.entries[0]).toMatchObject({ amount: -100, type: 'STREAK_FREEZE' });
    expect(h.state.coins).toBe(400);
    expect(h.state.coins).toBe(h.ledgerSum() + 500); // initial + entries
  });

  it('a repeated purchase for the same day fails safely with exactly one charge', async () => {
    const h = makeDb({ coins: 1000 });
    await purchase(h.service);
    await expect(purchase(h.service)).rejects.toThrow(ConflictException);
    expect(h.state.freezes).toHaveLength(1);
    const debits = h.state.entries.filter((e) => e.type === 'STREAK_FREEZE');
    expect(debits).toHaveLength(1);
    expect(h.state.coins).toBe(900);
    expect(h.state.coins).toBe(1000 + h.ledgerSum());
  });

  it('concurrent duplicate purchases collapse into one freeze and one debit', async () => {
    const h = makeDb({ coins: 1000 });
    const results = await Promise.allSettled([
      purchase(h.service),
      purchase(h.service),
      purchase(h.service),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(h.state.freezes).toHaveLength(1);
    expect(h.state.entries.filter((e) => e.type === 'STREAK_FREEZE')).toHaveLength(1);
    // Exactly one request wins; the losers roll back cleanly.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length).toBeLessThanOrEqual(1 + 0); // only one freeze exists
    expect(h.state.coins).toBe(900);
    expect(h.state.coins).toBe(1000 + h.ledgerSum());
  });

  it('rejects future dates with no ledger entry', async () => {
    const h = makeDb();
    await expect(purchase(h.service, { date: '2026-08-23' })).rejects.toThrow(BadRequestException);
    expect(h.state.entries).toHaveLength(0);
  });

  it('rejects unscheduled dates with no ledger entry', async () => {
    const h = makeDb({
      habit: {
        id: 'habit-1', userId: 'user-1', isArchived: false,
        scheduleType: 'specific_days', scheduleDays: ['Mon'], timesPerWeek: null,
        intervalDays: null, startDate: null,
      },
    });
    await expect(purchase(h.service, { date: '2026-08-21' })).rejects.toThrow(BadRequestException); // a Friday
    expect(h.state.entries).toHaveLength(0);
  });

  it('rejects already-completed dates with no ledger entry', async () => {
    const h = makeDb({ completedDate: true });
    await expect(purchase(h.service)).rejects.toThrow(ConflictException);
    expect(h.state.entries).toHaveLength(0);
  });

  it('rejects archived habits with no ledger entry', async () => {
    const h = makeDb({ habit: { id: 'habit-1', userId: 'user-1', isArchived: true, scheduleType: 'daily', scheduleDays: null, timesPerWeek: null, intervalDays: null, startDate: null } });
    await expect(purchase(h.service)).rejects.toThrow(ConflictException);
    expect(h.state.entries).toHaveLength(0);
  });

  it('rejects unknown habits with no ledger entry', async () => {
    const h = makeDb({ habit: null });
    await expect(purchase(h.service)).rejects.toThrow(NotFoundException);
    expect(h.state.entries).toHaveLength(0);
  });

  it("rejects another user's habit (not found for caller) with no ledger entry", async () => {
    const h = makeDb();
    await expect(purchase(h.service, { userId: 'attacker-1' })).rejects.toThrow(NotFoundException);
    expect(h.state.entries).toHaveLength(0);
  });

  it('rejects insufficient coins and never overdraws', async () => {
    const h = makeDb({ coins: 50 });
    await expect(purchase(h.service)).rejects.toThrow(BadRequestException);
    expect(h.state.freezes).toHaveLength(0);
    // The debit was rolled back with the transaction.
    expect(h.state.coins).toBe(50);
    expect(h.state.coins).toBe(50 + h.ledgerSum());
  });

  it('rejects malformed dates before any write', async () => {
    const h = makeDb();
    await expect(purchase(h.service, { date: '08/22/2026' })).rejects.toThrow(BadRequestException);
    await expect(purchase(h.service, { date: 'garbage' })).rejects.toThrow(BadRequestException);
    expect(h.state.entries).toHaveLength(0);
  });

  it('competing freezes on different habits cannot drive coins negative', async () => {
    const h = makeDb({ coins: 150 });
    // Two habits, each costing 100 — only one can succeed.
    const otherHabit = { ...{ id: 'habit-2', userId: 'user-1', isArchived: false, scheduleType: 'daily', scheduleDays: null, timesPerWeek: null, intervalDays: null, startDate: null } };
    h.tx.habit.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'habit-2' ? otherHabit : { id: 'habit-1', userId: 'user-1', isArchived: false, scheduleType: 'daily', scheduleDays: null, timesPerWeek: null, intervalDays: null, startDate: null }),
    );

    const results = await Promise.allSettled([
      purchase(h.service, { habitId: 'habit-1' }),
      purchase(h.service, { habitId: 'habit-2' }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    expect(succeeded).toHaveLength(1);
    expect(h.state.coins).toBe(50);
    expect(h.state.coins).toBe(150 + h.ledgerSum());
    expect(h.state.coins).toBeGreaterThanOrEqual(0);
  });
});
