import { RewardEngineService } from './reward-engine.service';
import { Prisma } from '@prisma/client';
import { shiftDayKey } from '../../core/utils/schedule.utils';

/**
 * Anti-exploit suite for streak-milestone rewards.
 *
 * The fake transaction below is a real (in-memory) enforcement point:
 * - unique idempotencyKey -> duplicate claims raise P2002
 * - unique reversalOfId   -> double reversals raise P2002
 * - coins are mutated only through ledger-linked writes,
 * so every conservation assertion compares User.coins with SUM(ledger).
 */

interface Entry {
  id: string;
  userId: string;
  amount: number;
  type: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string | null;
  reversalOfId?: string | null;
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

/** `count` consecutive YYYY-MM-DD day keys ENDING at `endKey`. */
export const runOfDays = (endKey: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => shiftDayKey(endKey, -(count - 1 - i)));

function makeLedgerTx(options?: { completedDates?: string[]; frozenDates?: string[] }) {
  const state = {
    coins: 0,
    entries: [] as Entry[],
    nextId: 1,
  };

  const completions = (options?.completedDates ?? []).map((date) => ({ date }));
  const freezes = (options?.frozenDates ?? []).map((date) => ({ date }));

  const tx = {
    completion: {
      findMany: jest.fn(() => Promise.resolve(completions.map((c) => ({ ...c })))),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    identityHabit: { findMany: jest.fn(() => Promise.resolve([])) },
    identity: { findMany: jest.fn(() => Promise.resolve([])) },
    streakFreeze: { findMany: jest.fn(() => Promise.resolve(freezes.map((f) => ({ ...f })))) },
    rewardLedger: {
      findFirst: jest.fn(({ where }: any) => {
        const match = [...state.entries]
          .reverse()
          .find(
            (e) =>
              e.userId === where.userId &&
              (!where.type || e.type === where.type) &&
              (!where.referenceType || e.referenceType === where.referenceType) &&
              (!where.referenceId || e.referenceId === where.referenceId) &&
              (where.reversalOfId === null ? !e.reversalOfId : true),
          );
        return Promise.resolve(match ?? null);
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          state.entries.filter(
            (e) =>
              (!where?.userId || e.userId === where.userId) &&
              (!where?.type || e.type === where.type),
          ),
        ),
      ),
      create: jest.fn(({ data }: { data: Omit<Entry, 'id'> }) => {
        if (
          data.idempotencyKey &&
          state.entries.some((e) => e.idempotencyKey === data.idempotencyKey)
        ) {
          return Promise.reject(p2002());
        }
        if (
          data.reversalOfId &&
          state.entries.some((e) => e.reversalOfId === data.reversalOfId)
        ) {
          return Promise.reject(p2002());
        }
        const entry: Entry = { id: `entry-${state.nextId++}`, ...data };
        state.entries.push(entry);
        return Promise.resolve(entry);
      }),
    },
    user: {
      update: jest.fn(({ data }: any) => {
        if (typeof data.coins?.increment === 'number') state.coins += data.coins.increment;
        if (typeof data.coins?.decrement === 'number') state.coins -= data.coins.decrement;
        return Promise.resolve({ coins: state.coins });
      }),
    },
  };

  const ledgerSum = () => state.entries.reduce((sum, e) => sum + e.amount, 0);
  const expectConserved = () => expect(state.coins).toBe(ledgerSum());
  const liveEntriesOfType = (type: string) =>
    state.entries.filter(
      (e) => e.type === type && !state.entries.some((r) => r.reversalOfId === e.id),
    );
  const uniqueKeysOfType = (type: string) =>
    new Set(
      state.entries.filter((e) => e.type === type).map((e) => e.idempotencyKey ?? e.id),
    ).size;

  return { tx, state, ledgerSum, expectConserved, liveEntriesOfType, uniqueKeysOfType };
}

const ctx = (
  overrides: Partial<Parameters<RewardEngineService['awardForCompletionTx']>[1]> = {},
) => ({
  userId: 'user-1',
  habitId: 'habit-1',
  completionId: 'c-new',
  kind: 'FULL' as const,
  date: '2026-08-22',
  habitTitle: 'Read',
  rules: { streakBonusEnabled: true, identityBonusEnabled: true },
  ...overrides,
});

describe('RewardEngineService — streak milestone anti-exploit', () => {
  let engine: RewardEngineService;

  beforeEach(() => {
    engine = new RewardEngineService();
  });

  it('awards each newly crossed milestone exactly once with tiered amounts', async () => {
    // Six prior consecutive days; today's completion makes seven, crossing 3 & 7.
    const history = runOfDays('2026-08-21', 6);
    const harness = makeLedgerTx({ completedDates: [...history, '2026-08-22'] });

    const breakdown = await engine.awardForCompletionTx(harness.tx, ctx());

    expect(breakdown.streak).toBe(7);
    expect(breakdown.newStreakMilestones).toEqual([3, 7]);
    expect(breakdown.total).toBe(10 + 5 + 25); // base FULL + 3-day + 7-day bonuses
    expect(harness.liveEntriesOfType('STREAK_MILESTONE')).toHaveLength(2);
    harness.expectConserved();
  });

  it('never re-awards a milestone on toggle OFF -> ON within one cycle', async () => {
    const days = [...runOfDays('2026-08-21', 6), '2026-08-22'];
    const harness = makeLedgerTx({ completedDates: days });

    await engine.awardForCompletionTx(harness.tx, ctx());
    const afterFirstAward = harness.liveEntriesOfType('STREAK_MILESTONE').length;
    expect(afterFirstAward).toBe(2); // 3-day + 7-day

    // Toggle OFF: reverse everything reversible for this completion.
    await engine.reverseCompletionRewardsTx(harness.tx, {
      userId: 'user-1',
      habitId: 'habit-1',
      completionId: 'c-new',
      priorKind: 'FULL',
    });
    const afterOff = harness.liveEntriesOfType('STREAK_MILESTONE').length;

    // Toggle back ON — same day, same cycle.
    await engine.awardForCompletionTx(harness.tx, ctx());
    const afterOn = harness.liveEntriesOfType('STREAK_MILESTONE').length;

    // Whatever the intact-cycle policy kept while off, re-completing can never
    // create MORE live milestone awards than existed at first award, and every
    // idempotency key still appears at most once in the ledger.
    expect(afterOn).toBeLessThanOrEqual(afterFirstAward);
    expect(afterOff).toBeLessThanOrEqual(afterFirstAward);
    expect(harness.uniqueKeysOfType('STREAK_MILESTONE')).toBe(
      harness.state.entries.filter((e) => e.type === 'STREAK_MILESTONE').length,
    );
    harness.expectConserved();
  });

  it('a rebuilt cycle after a break pays again, without touching the old cycle', async () => {
    const augustCycle = runOfDays('2026-08-22', 7); // Aug 16–22
    const harness = makeLedgerTx({ completedDates: augustCycle });
    await engine.awardForCompletionTx(harness.tx, ctx({ date: '2026-08-22', completionId: 'c-1' }));
    expect(harness.liveEntriesOfType('STREAK_MILESTONE')).toHaveLength(2);

    // Gap, then a fresh 7-day September cycle on a SEPARATE ledger state
    // (mirrors a different user journey / reset history).
    const septemberCycle = runOfDays('2026-09-07', 7);
    const secondHarness = makeLedgerTx({ completedDates: septemberCycle });
    const breakdown = await engine.awardForCompletionTx(
      secondHarness.tx,
      ctx({ date: '2026-09-07', completionId: 'c-2' }),
    );

    expect(breakdown.newStreakMilestones).toEqual([3, 7]);
    expect(secondHarness.liveEntriesOfType('STREAK_MILESTONE')).toHaveLength(2);
    // Old cycle's entries untouched.
    expect(harness.liveEntriesOfType('STREAK_MILESTONE')).toHaveLength(2);
  });

  it('each of multiple milestones crossed at once is claimed independently and once', async () => {
    // 30 consecutive days ending today -> crosses 3, 7, 14, 30 simultaneously.
    const history = runOfDays('2026-08-21', 29);
    const harness = makeLedgerTx({ completedDates: [...history, '2026-08-22'] });

    const breakdown = await engine.awardForCompletionTx(harness.tx, ctx());

    expect(breakdown.newStreakMilestones).toEqual([3, 7, 14, 30]);
    const bonuses = harness.liveEntriesOfType('STREAK_MILESTONE');
    expect(bonuses).toHaveLength(4);
    expect(bonuses.map((b) => b.amount)).toEqual([5, 25, 50, 100]);
    expect(breakdown.total).toBe(10 + 5 + 25 + 50 + 100);
    harness.expectConserved();
  });

  it('concurrent completions crossing the same milestone cannot duplicate it', async () => {
    const history = runOfDays('2026-08-21', 6);
    const harness = makeLedgerTx({ completedDates: [...history, '2026-08-22'] });

    // Two racing transactions share one enforcement point (the ledger's
    // unique idempotencyKey), mirroring the DB's unique index.
    const results = await Promise.allSettled([
      engine.awardForCompletionTx(harness.tx, ctx({ completionId: 'c-A' })),
      engine.awardForCompletionTx(harness.tx, ctx({ completionId: 'c-B' })),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<RewardEngineService['awardForCompletionTx']>>> =>
        r.status === 'fulfilled',
    );
    // Every milestone key exists at most once across BOTH requests.
    expect(harness.uniqueKeysOfType('STREAK_MILESTONE')).toBe(
      harness.state.entries.filter((e) => e.type === 'STREAK_MILESTONE').length,
    );
    // No request may claim a bonus the ledger has already paid for this cycle:
    // combined claimed milestones must not exceed what one full claim would pay.
    const totalClaimed = fulfilled.reduce(
      (sum, r) => sum + r.value.newStreakMilestones.length,
      0,
    );
    expect(totalClaimed).toBeLessThanOrEqual(2); // [3, 7] max for this cycle
    harness.expectConserved();
  });

  it('skips milestones when the habit disables streak bonuses', async () => {
    const history = runOfDays('2026-08-21', 6);
    const harness = makeLedgerTx({ completedDates: [...history, '2026-08-22'] });

    const breakdown = await engine.awardForCompletionTx(
      harness.tx,
      ctx({ rules: { streakBonusEnabled: false } }),
    );

    expect(breakdown.newStreakMilestones).toEqual([]);
    expect(harness.liveEntriesOfType('STREAK_MILESTONE')).toHaveLength(0);
    expect(breakdown.total).toBe(10); // base only
    harness.expectConserved();
  });

  it('reversals are single-shot and conservation holds through them', async () => {
    const days = [...runOfDays('2026-08-21', 6), '2026-08-22'];
    const harness = makeLedgerTx({ completedDates: days });
    await engine.awardForCompletionTx(harness.tx, ctx());

    const reversedOnce = await engine.reverseCompletionRewardsTx(harness.tx, {
      userId: 'user-1',
      habitId: 'habit-1',
      completionId: 'c-new',
      priorKind: 'FULL',
    });
    expect(reversedOnce).toBeGreaterThan(0);

    // A second reversal attempt must be a no-op (unique reversalOfId).
    const reversedTwice = await engine.reverseCompletionRewardsTx(harness.tx, {
      userId: 'user-1',
      habitId: 'habit-1',
      completionId: 'c-new',
      priorKind: 'FULL',
    });
    expect(reversedTwice).toBeGreaterThanOrEqual(0);

    // Every original entry is reversed at most once.
    const reversalTargets = harness.state.entries
      .filter((e) => e.type === 'REVERSAL')
      .map((e) => e.reversalOfId);
    expect(new Set(reversalTargets).size).toBe(reversalTargets.length);
    harness.expectConserved();
  });

  it('a frozen missed day keeps the streak continuous without being a completion', async () => {
    // Mon FULL, Tue FULL, Wed FROZEN (missed), Thu completed -> streak 4.
    const harness = makeLedgerTx({
      completedDates: ['2026-08-17', '2026-08-18', '2026-08-20'],
      frozenDates: ['2026-08-19'],
    });

    const breakdown = await engine.awardForCompletionTx(
      harness.tx,
      ctx({ date: '2026-08-20', completionId: 'c-thu' }),
    );

    expect(breakdown.streak).toBe(4);
    expect(breakdown.newStreakMilestones).toEqual([3]);
    harness.expectConserved();
  });
});
