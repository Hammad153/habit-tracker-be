import { Injectable, Logger } from '@nestjs/common';
import { CompletionKind, Prisma, RewardTransactionType } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { COINS_PER_COMPLETION } from '../../core/utils/evidence.constants';

type Tx = Prisma.TransactionClient;

const KIND_TO_LEDGER_TYPE: Record<CompletionKind, RewardTransactionType> = {
  FULL: 'HABIT_COMPLETION',
  MINIMUM: 'HABIT_MINIMUM_COMPLETION',
  EMERGENCY: 'HABIT_EMERGENCY_COMPLETION',
};

export interface CompletionAwardInput {
  userId: string;
  completionId: string;
  kind: CompletionKind;
  habitTitle?: string;
}

/**
 * Virtual currency (coins).
 *
 * The RewardLedger is append-only and is the single source of truth.
 * User.coins is a cached balance that must only ever be updated inside the
 * same transaction as the ledger entries it reflects.
 *
 * Idempotency model:
 * - AWARDS are keyed by the completion row itself. A completion can be
 *   awarded more than once over its life (same-day kind transitions), but
 *   never twice for the same state transition — the transition decision and
 *   both writes share one transaction on the unique (habitId, date) row.
 * - REVERSALS are strictly one-per-ledger-entry via the unique reversalOfId
 *   constraint; a second reversal attempt hits P2002 and is a no-op.
 *
 * Coins are an in-app currency. They are NOT money and must never be wired
 * to any payment provider or real-world value.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(private readonly databaseSvc: DatabaseService) {}

  public coinsForKind(kind: CompletionKind): number {
    return COINS_PER_COMPLETION[kind] ?? 0;
  }

  /**
   * Records a coin award for a completion and updates the cached balance,
   * atomically. Callers must only invoke this on an actual award transition;
   * duplicate protection lives in the completion state machine.
   */
  public async awardForCompletion(
    tx: Tx,
    input: CompletionAwardInput,
  ): Promise<number> {
    const amount = this.coinsForKind(input.kind);
    if (!amount) return 0;

    await tx.rewardLedger.create({
      data: {
        userId: input.userId,
        amount,
        type: KIND_TO_LEDGER_TYPE[input.kind],
        referenceType: 'COMPLETION',
        referenceId: input.completionId,
        description: input.habitTitle
          ? `Completed ${input.kind.toLowerCase()}: ${input.habitTitle}`
          : undefined,
      },
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { coins: { increment: amount } },
    });

    return amount;
  }

  /**
   * Reverses the most recent UNREVERSED award recorded for a completion
   * (toggle-off / downgrade). Creates a REVERSAL entry pointing at the
   * original entry and decrements the cached balance. Returns the reversed
   * amount, or 0 when there was nothing left to reverse.
   */
  public async reverseCompletionAward(
    tx: Tx,
    input: CompletionAwardInput,
  ): Promise<number> {
    const original = await this.findReversibleAward(tx, input);
    if (!original || original.amount <= 0) return 0;

    try {
      await tx.rewardLedger.create({
        data: {
          userId: input.userId,
          amount: -original.amount,
          type: 'REVERSAL',
          referenceType: 'LEDGER_ENTRY',
          referenceId: original.id,
          // Unique constraint: one reversal per original entry, ever.
          reversalOfId: original.id,
          description: input.habitTitle
            ? `Reversed reward for ${input.habitTitle}`
            : 'Reversed habit reward',
        },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        // Lost a race against a concurrent reversal of the same entry.
        return 0;
      }
      throw err;
    }

    const user = await tx.user.update({
      where: { id: input.userId },
      data: { coins: { decrement: original.amount } },
      select: { coins: true },
    });
    if (user.coins < 0) {
      this.logger.warn(
        `Negative coin balance for user ${input.userId}: ${user.coins}`,
      );
    }

    return original.amount;
  }

  /** Latest award entry of `kind` for the completion that has not been reversed. */
  private async findReversibleAward(
    tx: Tx,
    input: CompletionAwardInput,
  ): Promise<Prisma.RewardLedgerGetPayload<object> | null> {
    return tx.rewardLedger.findFirst({
      where: {
        userId: input.userId,
        type: KIND_TO_LEDGER_TYPE[input.kind],
        referenceType: 'COMPLETION',
        referenceId: input.completionId,
        reversalOfId: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Authoritative balance derived from the ledger, compared against the
   * cached User.coins value. Read-only: never mutates balances implicitly.
   */
  public async reconcileBalance(userId: string): Promise<{
    ledgerBalance: number;
    cachedUserBalance: number;
    difference: number;
    consistent: boolean;
  }> {
    const [aggregated, user] = await Promise.all([
      this.databaseSvc.rewardLedger.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
      this.databaseSvc.user.findUnique({
        where: { id: userId },
        select: { coins: true },
      }),
    ]);
    const ledgerBalance = aggregated._sum.amount ?? 0;
    const cachedUserBalance = user?.coins ?? 0;
    const difference = cachedUserBalance - ledgerBalance;
    return {
      ledgerBalance,
      cachedUserBalance,
      difference,
      consistent: difference === 0,
    };
  }

  /** Back-compat shape used by GET /reward/balance. */
  public async getBalance(userId: string): Promise<{
    balance: number;
    cachedBalance: number;
    consistent: boolean;
  }> {
    const reconciled = await this.reconcileBalance(userId);
    return {
      balance: reconciled.ledgerBalance,
      cachedBalance: reconciled.cachedUserBalance,
      consistent: reconciled.consistent,
    };
  }

  /**
   * EXPLICIT repair for a detected drift. Never called from ordinary reads.
   * Transactional and audited: the correction is written to the ledger as an
   * ADJUSTMENT entry so SUM(ledger) equals the repaired cache afterwards by
   * construction (the adjustment makes the ledger agree with the cache).
   */
  public async repairBalanceFromCache(
    userId: string,
    options?: { authorizedBy?: string },
  ): Promise<{ adjustedBy: number }> {
    return this.databaseSvc.$transaction(async (tx) => {
      const [aggregated, user] = await Promise.all([
        tx.rewardLedger.aggregate({ where: { userId }, _sum: { amount: true } }),
        tx.user.findUnique({ where: { id: userId }, select: { coins: true } }),
      ]);
      const ledgerBalance = aggregated._sum.amount ?? 0;
      const cached = user?.coins ?? 0;
      const difference = cached - ledgerBalance;
      if (difference === 0) return { adjustedBy: 0 };

      await tx.rewardLedger.create({
        data: {
          userId,
          amount: difference,
          type: 'ADJUSTMENT',
          referenceType: 'MANUAL_REPAIR',
          referenceId: options?.authorizedBy ?? 'system',
          description: `Balance repair: aligned ledger to cached balance (drift ${difference})`,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { coins: ledgerBalance + difference },
      });

      this.logger.warn(
        `Coin balance repaired for user ${userId} (drift ${difference}${
          options?.authorizedBy ? `, by ${options.authorizedBy}` : ''
        })`,
      );
      return { adjustedBy: difference };
    });
  }

  public async listTransactions(
    userId: string,
    options?: { take?: number; cursor?: string },
  ) {
    return this.databaseSvc.rewardLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options?.take ?? 50, 100),
      ...(options?.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    });
  }
}
