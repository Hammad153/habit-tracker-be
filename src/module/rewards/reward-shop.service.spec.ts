import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RewardShopService } from './reward-shop.service';

/**
 * Reward-shop anti-exploit suite.
 * The fake database enforces the (userId, itemId) unique constraint and uses
 * the same serialized-transaction journal as the freeze spec, so tests can
 * assert: exactly-one-winner races, no charge on failure, and
 * User.coins === SUM(RewardLedger) at all times.
 */

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

interface ItemRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  cost: number;
  type: string;
  status: string;
}

const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: 'item-1',
  key: 'theme_dark',
  name: 'Dark Theme',
  description: null,
  cost: 400,
  type: 'COSMETIC',
  status: 'ACTIVE',
  ...over,
});

function makeDb(options?: { coins?: number; items?: ItemRow[] }) {
  const state = {
    coins: options?.coins ?? 1000,
    entries: [] as Array<{ id: string; amount: number; type: string; referenceId?: string }>,
    redemptions: [] as Array<{ id: string; userId: string; itemId: string; cost: number }>,
    nextId: 1,
  };
  const items = options?.items ?? [item()];

  interface Journal {
    coinsDelta: number;
    entries: Array<{ id: string; amount: number; type: string; referenceId?: string }>;
    redemptions: Array<{ id: string; userId: string; itemId: string; cost: number }>;
  }

  let chain: Promise<unknown> = Promise.resolve();

  const db = {
    // Non-transactional reads (listItems).
    rewardItem: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          items.filter((i) => (!where?.status || i.status === where.status)),
        ),
      ),
    },
    rewardRedemption: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(state.redemptions.filter((r) => r.userId === where.userId)),
      ),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => runOne(fn));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  };

  async function runOne(fn: (tx: unknown) => Promise<unknown>) {
    const j: Journal = { coinsDelta: 0, entries: [], redemptions: [] };
    const visibleRedemption = (userId: string, itemId: string) =>
      state.redemptions.find((r) => r.userId === userId && r.itemId === itemId) ??
      j.redemptions.find((r) => r.userId === userId && r.itemId === itemId) ??
      null;

    const tx = {
      rewardItem: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(items.find((i) => i.id === where.id) ?? null),
        ),
      },
      rewardRedemption: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(visibleRedemption(where.userId_itemId.userId, where.userId_itemId.itemId)),
        ),
        create: jest.fn(({ data }: any) => {
          if (visibleRedemption(data.userId, data.itemId)) return Promise.reject(p2002());
          const row = { id: `red-${state.nextId++}`, ...data };
          j.redemptions.push(row);
          return Promise.resolve(row);
        }),
      },
      user: {
        findUnique: jest.fn(() => Promise.resolve({ coins: state.coins + j.coinsDelta })),
        update: jest.fn(({ data }: any) => {
          if (typeof data.coins?.decrement === 'number') j.coinsDelta -= data.coins.decrement;
          return Promise.resolve({ coins: state.coins + j.coinsDelta });
        }),
      },
      rewardLedger: {
        create: jest.fn(({ data }: any) => {
          const entry = { id: `entry-${state.nextId++}`, ...data };
          j.entries.push(entry);
          return Promise.resolve(entry);
        }),
      },
    };

    const result = await fn(tx);
    state.coins += j.coinsDelta;
    state.entries.push(...j.entries);
    state.redemptions.push(...j.redemptions);
    return result;
  }

  const ledgerSum = () => state.entries.reduce((s, e) => s + e.amount, 0);
  const service = new RewardShopService(db as any);
  return { service, state, ledgerSum };
}

describe('RewardShopService', () => {
  it('lists only ACTIVE items with correct owned flags', async () => {
    const h = makeDb({
      coins: 0,
      items: [item(), item({ id: 'item-2', key: 'k2', name: 'Other' }), item({ id: 'item-3', status: 'INACTIVE' })],
    });
    h.state.redemptions.push({ id: 'r1', userId: 'user-1', itemId: 'item-2', cost: 10 });

    const listed = await h.service.listItems('user-1');
    expect(listed.map((i) => i.id)).toEqual(['item-1', 'item-2']); // INACTIVE hidden, cost asc
    expect(listed.find((i) => i.id === 'item-2')!.owned).toBe(true);
    expect(listed.find((i) => i.id === 'item-1')!.owned).toBe(false);
  });

  it('redeems: one debit of the SERVER-side cost, coins reduced, redemption stored', async () => {
    const h = makeDb({ coins: 1000 });
    const result = await h.service.redeemItem('user-1', 'item-1');

    expect(result.remainingCoins).toBe(600);
    expect(h.state.entries).toHaveLength(1);
    expect(h.state.entries[0]).toMatchObject({ amount: -400, type: 'REWARD_REDEMPTION', referenceId: 'item-1' });
    expect(h.state.redemptions).toHaveLength(1);
    // Conservation: initial + ledger == current.
    expect(h.state.coins).toBe(1000 + h.ledgerSum());
  });

  it('rejects duplicate redemption without a second charge', async () => {
    const h = makeDb({ coins: 1000 });
    await h.service.redeemItem('user-1', 'item-1');
    await expect(h.service.redeemItem('user-1', 'item-1')).rejects.toThrow(ConflictException);
    expect(h.state.entries.filter((e) => e.type === 'REWARD_REDEMPTION')).toHaveLength(1);
    expect(h.state.coins).toBe(600);
    expect(h.state.coins).toBe(1000 + h.ledgerSum());
  });

  it('rejects unknown or inactive items before any write', async () => {
    const h = makeDb({ coins: 1000, items: [item({ status: 'INACTIVE' })] });
    await expect(h.service.redeemItem('user-1', 'missing')).rejects.toThrow(NotFoundException);
    await expect(h.service.redeemItem('user-1', 'item-1')).rejects.toThrow(BadRequestException);
    expect(h.state.entries).toHaveLength(0);
    expect(h.state.redemptions).toHaveLength(0);
  });

  it('never overdraws: unaffordable purchase leaves balance untouched', async () => {
    const h = makeDb({ coins: 100 });
    await expect(h.service.redeemItem('user-1', 'item-1')).rejects.toThrow(BadRequestException);
    expect(h.state.coins).toBe(100);
    expect(h.state.redemptions).toHaveLength(0);
    // The candidate tx rolled back its own debit.
    expect(h.state.entries).toHaveLength(0);
  });

  it('CRITICAL: two concurrent purchases costing more than the balance — exactly one wins', async () => {
    // 500 coins, two items at 400 each: buying both would overdraw.
    const h = makeDb({
      coins: 500,
      items: [item(), item({ id: 'item-2', key: 'k2', name: 'Other', cost: 400 })],
    });

    const results = await Promise.allSettled([
      h.service.redeemItem('user-1', 'item-1'),
      h.service.redeemItem('user-1', 'item-2'),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);
    expect(h.state.redemptions).toHaveLength(1);
    expect(h.state.coins).toBe(100);
    expect(h.state.coins).toBeGreaterThanOrEqual(0);
    // Conservation invariant held through the race.
    expect(h.state.coins).toBe(500 + h.ledgerSum());
  });

  it('concurrent double-redeem of the SAME item yields one owner and one debit', async () => {
    const h = makeDb({ coins: 5000 });
    const results = await Promise.allSettled([
      h.service.redeemItem('user-1', 'item-1'),
      h.service.redeemItem('user-1', 'item-1'),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);
    expect(h.state.redemptions).toHaveLength(1);
    expect(h.state.entries).toHaveLength(1);
    expect(h.state.coins).toBe(4600);
    expect(h.state.coins).toBe(5000 + h.ledgerSum());
  });

  it('a rejected transaction never leaks another request’s committed writes', async () => {
    // Winner commits a 400-cost purchase; loser for an unaffordable item
    // must not roll back the winner's writes.
    const h = makeDb({
      coins: 450,
      items: [item(), item({ id: 'item-big', cost: 40000 })],
    });
    await expect(h.service.redeemItem('user-1', 'item-big')).rejects.toThrow(BadRequestException);
    const ok = await h.service.redeemItem('user-1', 'item-1');
    expect(ok.remainingCoins).toBe(50);
    expect(h.state.coins).toBe(50);
    expect(h.state.coins).toBe(450 + h.ledgerSum());
  });
});
