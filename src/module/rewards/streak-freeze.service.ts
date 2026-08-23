import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { isScheduledOnDate } from '../../core/utils/schedule.utils';
import { STREAK_FREEZE_COST } from '../../core/utils/evidence.constants';

/**
 * Streak Freeze — purchasable protection for one missed scheduled occurrence.
 *
 * A freeze is NOT a completion: it never grants XP, coins, identity evidence
 * or a temptation unlock. It only keeps the streak calculation continuous
 * (see computeCurrentStreak / isMilestoneCycleIntact, which both honor
 * frozen days).
 *
 * Purchase integrity (single transaction):
 * - habit ownership/archive/schedule/completion-state validation
 * - unique (habitId, date): duplicate & concurrent requests collapse into
 *   "already protected" via P2002 — exactly one freeze and one debit exist
 * - ledger debit (STREAK_FREEZE, negative amount) + cached-balance decrement
 *   happen together; the balance is re-checked AFTER this transaction's own
 *   debit so competing debits can never commit an overdrawn state.
 */
@Injectable()
export class StreakFreezeService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  public async purchaseFreeze(userId: string, habitId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date format, expected YYYY-MM-DD');
    }

    return this.databaseSvc.$transaction(async (tx) => {
      const habit = await tx.habit.findUnique({ where: { id: habitId } });
      if (!habit) throw new NotFoundException('Habit not found');
      if (habit.userId !== userId) throw new NotFoundException('Habit not found');
      if (habit.isArchived) {
        throw new ConflictException('Archived habits cannot be protected');
      }

      const today = new Date().toISOString().slice(0, 10);
      if (date > today) {
        throw new BadRequestException('Future dates cannot be protected');
      }
      if (!isScheduledOnDate(habit, date)) {
        throw new BadRequestException(
          'This date is not a scheduled occurrence for this habit',
        );
      }

      const completed = await tx.completion.findFirst({
        where: { habitId, date, status: true },
        select: { id: true },
      });
      if (completed) {
        throw new ConflictException(
          'This day is already completed — there is nothing to protect',
        );
      }

      const alreadyFrozen = await tx.streakFreeze.findUnique({
        where: { habitId_date: { habitId, date } },
      });
      if (alreadyFrozen) {
        throw new ConflictException('This day is already protected');
      }

      // Debit first, validate after: mirrors RewardShopService so concurrent
      // competing debits cannot commit a negative balance.
      await tx.rewardLedger.create({
        data: {
          userId,
          amount: -STREAK_FREEZE_COST,
          type: 'STREAK_FREEZE',
          referenceType: 'HABIT_DAY',
          referenceId: `${habitId}:${date}`,
          description: 'Streak freeze',
        },
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { coins: { decrement: STREAK_FREEZE_COST } },
        select: { coins: true },
      });
      if (updated.coins < 0) {
        throw new BadRequestException('Insufficient coins for a streak freeze');
      }

      try {
        return await tx.streakFreeze.create({
          data: { userId, habitId, date, cost: STREAK_FREEZE_COST },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Concurrent identical request won: roll this debit back by
          // aborting with 409 — the winner already charged exactly once.
          throw new ConflictException('This day is already protected');
        }
        throw err;
      }
    });
  }
}
