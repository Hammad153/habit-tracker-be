import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, RewardTransactionType } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { isScheduledOnDate } from '../../core/utils/schedule.utils';
import { STREAK_FREEZE_COST } from '../../core/utils/evidence.constants';

type Tx = Prisma.TransactionClient;

/** Service for purchasing a one‑day streak freeze. */
@Injectable()
export class StreakFreezeService {
  constructor(private readonly db: DatabaseService) {}

  /** Purchase a freeze for a habit on a given date. */
  async purchaseFreeze(userId: string, habitId: string, date: string) {
    return this.db.$transaction(async (tx) => {
      // Validate habit ownership & status
      const habit = await tx.habit.findUnique({
        where: { id: habitId },
        select: {
          userId: true,
          isArchived: true,
          scheduleType: true,
          scheduleDays: true,
          timesPerWeek: true,
          intervalDays: true,
          startDate: true,
        },
      });
      if (!habit) {
        throw new BadRequestException('Habit not found');
      }
      if (habit.userId !== userId) {
        throw new BadRequestException('Habit does not belong to user');
      }
      if (habit.isArchived) {
        throw new ConflictException('Cannot protect an archived habit');
      }

      // Validate date is not in the future
      const today = new Date().toISOString().slice(0, 10);
      if (date > today) {
        throw new BadRequestException('Cannot protect future dates');
      }

      // Validate scheduled occurrence
      if (!isScheduledOnDate(habit, date)) {
        throw new BadRequestException('Date is not a scheduled occurrence for this habit');
      }

      // Ensure no completed completion for this date
      const existingCompletion = await tx.completion.findFirst({
        where: { habitId, date, status: true },
        select: { id: true },
      });
      if (existingCompletion) {
        throw new ConflictException('Cannot protect a day that already has a completed habit');
      }

      // Load user balance
      const user = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
      if (!user) throw new BadRequestException('User not found');
      if (user.coins < STREAK_FREEZE_COST) {
        throw new BadRequestException('Insufficient coins for freeze');
      }

      // Attempt to create freeze – unique constraint guarantees idempotency
      try {
        const freeze = await tx.streakFreeze.create({ data: { userId, habitId, date, cost: STREAK_FREEZE_COST } });
        // Debit coins via ledger entry
        await tx.rewardLedger.create({
          data: {
            userId,
            amount: -STREAK_FREEZE_COST,
            type: 'STREAK_FREEZE',
            referenceType: 'STREAK_FREEZE',
            referenceId: freeze.id,
          },
        });
        // Update cached balance
        await tx.user.update({ where: { id: userId }, data: { coins: { decrement: STREAK_FREEZE_COST } } });
        return freeze;
      } catch (e) {
        // Unique constraint violation = already protected
        if ((e as any).code === 'P2002') {
          return tx.streakFreeze.findFirst({ where: { habitId, date } });
        }
        throw e;
      }
    });
  }
}
