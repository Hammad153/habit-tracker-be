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
 * The RewardLedger is the single source of truth. User.coins is a cached
 * balance that must only ever be updated inside the same transaction as the
 * ledger entry it reflects.
 *
 * Coins are an in-app currency. They are NOT money and must never be wired to
 * any payment provider or real-world value.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(private readonly databaseSvc: DatabaseService) {}

  public coinsForKind(kind: CompletionKind): number {
    return COINS_PER_COMPLETION[kind] ?? 0;
  }

  /**
   * Records the coin award for a completion and updates the cached balance,
   * atomically. Idempotent: the unique (type, referenceId) constraint makes a
   * duplicate award for the same completion impossible; in that case this
   * returns 0 so callers can detect no-op awards.
   */
  public async awardForCompletion(
    tx: Tx,
    input: CompletionAwardInput,
  ): Promise<number> {
    const amount = this.coinsForKind(input.kind);
    if (!amount) return 0;

    const type = KIND_TO_LEDGER_TYPE[input.kind];
    try {
      await tx.rewardLedger.create({
        data: {
          userId: input.userId,
          amount,
          type,
          referenceType: 'COMPLETION',
          referenceId: input.completionId,
          description: input.habitTitle
            ? `Completed ${input.kind.toLowerCase()}: ${input.habitTitle}`
            : undefined,
        },
      });
    } catch (err) {
      // P2002: this completion was already awarded (race with itself).
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        return 0;
      }
      throw err;
    }

    await tx.user.update({
      where: { id: input.userId },
      data: { coins: { increment: amount } },
    });

    return amount;
  }

  /**
   * Reverses the award previously recorded for a completion (toggle-off /
   * downgrade). Creates a REVERSAL entry referencing the original entry and
   * decrements the cached balance. Returns the reversed amount, or 0 when
   * there was nothing to reverse.
   */
  public async reverseCompletionAward(
    tx: Tx,
    input: CompletionAwardInput,
  ): Promise<number> {
    const originalType = KIND_TO_LEDGER_TYPE[input.kind];
    const original = await tx.rewardLedger.findUnique({
      where: {
        type_referenceId: {
          type: originalType,
          referenceId: input.completionId,
        },
      },
    });
    if (!original || original.amount <= 0) return 0;

    try {
      await tx.rewardLedger.create({
        data: {
          userId: input.userId,
          amount: -original.amount,
          type: 'REVERSAL',
          referenceType: 'LEDGER_ENTRY',
          referenceId: original.id,
          description: input.habitTitle
            ? `Reversed reward for ${input.habitTitle}`
            : 'Reversed habit reward',
        },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        // Already reversed once; never double-reverse.
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

  /** Authoritative balance derived from the ledger. */
  public async getBalance(userId: string): Promise<{
    balance: number;
    cachedBalance: number;
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
    const balance = aggregated._sum.amount ?? 0;
    const cachedBalance = user?.coins ?? 0;
    return { balance, cachedBalance, consistent: balance === cachedBalance };
  }

  public async listTransactions(
    userId: string,
    options?: { take?: number; cursor?: string },
  ) {
    return this.databaseSvc.rewardLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: options?.take ?? 50,
      ...(options?.cursor
        ? { skip: 1, cursor: { id: options.cursor } }
        : {}),
    });
  }
}
