import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';

export interface ShopListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  cost: number;
  type: string;
  owned: boolean;
}

/**
 * Virtual reward shop. Coins are the only currency and they come from the
 * RewardLedger — never from anywhere else.
 *
 * Redemption integrity:
 * - Cost is read from the RewardItem row; client-provided amounts are ignored.
 * - Ownership is enforced by the unique (userId, itemId) constraint; a lost
 *   race maps to 409 instead of a double charge.
 * - The balance check runs AFTER this transaction's own debit is applied, so
 *   two concurrent purchases that individually pass a pre-check cannot both
 *   commit: whichever would drive coins below zero rolls back entirely.
 */
@Injectable()
export class RewardShopService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  public async listItems(userId: string): Promise<ShopListItem[]> {
    const [items, redemptions] = await Promise.all([
      this.databaseSvc.rewardItem.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { cost: 'asc' },
      }),
      this.databaseSvc.rewardRedemption.findMany({
        where: { userId },
        select: { itemId: true },
      }),
    ]);
    const owned = new Set(redemptions.map((r) => r.itemId));
    return items.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      cost: item.cost,
      type: item.type,
      owned: owned.has(item.id),
    }));
  }

  public async redeemItem(
    userId: string,
    itemId: string,
  ): Promise<{ redemption: { id: string; itemId: string }; remainingCoins: number }> {
    return this.databaseSvc.$transaction(async (tx) => {
      const item = await tx.rewardItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Reward item not found');
      if (item.status !== 'ACTIVE') {
        throw new BadRequestException('This reward is no longer available');
      }

      const alreadyOwned = await tx.rewardRedemption.findUnique({
        where: { userId_itemId: { userId, itemId } },
        select: { id: true },
      });
      if (alreadyOwned) throw new ConflictException('You already own this reward');

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coins: true },
      });
      if (!user) throw new NotFoundException('User not found');

      // Debit first, validate after: makes concurrent competing purchases safe
      // without locks — an overdrawn candidate tx simply rolls back.
      await tx.rewardLedger.create({
        data: {
          userId,
          amount: -item.cost,
          type: 'REWARD_REDEMPTION',
          referenceType: 'REWARD_ITEM',
          referenceId: item.id,
          description: `Redeemed ${item.name}`,
        },
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { coins: { decrement: item.cost } },
        select: { coins: true },
      });
      if (updated.coins < 0) {
        throw new BadRequestException('Insufficient coins for this reward');
      }

      let redemptionId: string;
      try {
        const redemption = await tx.rewardRedemption.create({
          data: { userId, itemId, cost: item.cost },
        });
        redemptionId = redemption.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Concurrent duplicate request won the unique (userId, itemId).
          throw new ConflictException('You already own this reward');
        }
        throw err;
      }

      return {
        redemption: { id: redemptionId, itemId },
        remainingCoins: updated.coins,
      };
    });
  }
}
